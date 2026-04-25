import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  NextVEventRunner,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  runNextVScriptFromFile,
  validateOutputContract,
} from '../index.js'

import {
  areJsonStatesEqual,
  clearTimerHandles,
  createEventBus,
  createHostAdapter,
  createNextVRuntimeController,
  getDeclaredEffectChannels,
  getDeclaredExternals,
  hasMeaningfulNextVExecutionEvents,
  loadWorkspaceNextVConfig,
  normalizeEffectsPolicy,
  normalizeInputEvent,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  startTimerHandles,
  validateDeclaredEffectBindings,
} from '../host_core/index.js'

export function createRuntimeResolvers({ repoRoot }) {
  function toWorkspaceDisplayPath(absolutePath) {
    const rel = relative(repoRoot, absolutePath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath
    return rel.replace(/\\/g, '/')
  }

  function readJsonObjectFile(filePath) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`JSON at ${toWorkspaceDisplayPath(filePath)} must be an object`)
    }
    return parsed
  }

  function resolveWorkspaceDirectory(inputPath) {
    const candidate = String(inputPath ?? '').trim()
    if (!candidate) {
      return { absolutePath: repoRoot, relativePath: '.' }
    }
    if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

    const absolutePath = resolve(repoRoot, candidate)
    const rel = relative(repoRoot, absolutePath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Path is outside workspace')
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Workspace directory not found: ${candidate.replace(/\\/g, '/')}`)
    }

    return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
  }

  function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
    const candidate = String(inputPath ?? '').trim()
    if (!candidate) throw new Error('filePath required')
    if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

    const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
    const rel = relative(repoRoot, absolutePath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Path is outside workspace')
    }

    const ext = extname(absolutePath).toLowerCase()
    if (kindRaw === 'script' && ext && ext !== '.nrv' && ext !== '.wfs') {
      throw new Error(`Unsupported extension '${ext}' for script`)
    }

    return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
  }

  function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
    const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
    const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
    if (!rawEntrypoint) throw new Error('entrypointPath required (or set nextv.json entrypointPath)')

    const joined = join(
      workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath,
      rawEntrypoint,
    )
    const entrypoint = resolvePathFromBaseDirectory(repoRoot, joined.replace(/\\/g, '/'), 'script')
    if (!existsSync(entrypoint.absolutePath)) {
      throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
    }
    return entrypoint
  }

  return {
    resolveWorkspaceDirectory,
    loadWorkspaceConfig: (workspaceDir) =>
      loadWorkspaceNextVConfig({
        workspaceDir,
        toWorkspaceDisplayPath,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      }),
    resolveEntrypoint,
    resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath,
    readJsonObjectFile,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    existsSync,
  }
}

export function createRuntimeCore({
  sessionId = `runtime-${randomUUID()}`,
  callAgent = async () => {
    throw new Error('agent transport is not configured for runtime')
  },
  defaultModel = '',
  resolvers,
} = {}) {
  if (!resolvers || typeof resolvers !== 'object') {
    throw new Error('createRuntimeCore requires resolvers')
  }

  const eventBus = createEventBus()
  let lifecycleState = 'idle'
  let lastError = ''

  const runtimeController = createNextVRuntimeController({
    eventBus,
    createRunner: (options) => new NextVEventRunner(options),
    createHostAdapter,
    resolveWorkspaceDirectory: resolvers.resolveWorkspaceDirectory,
    loadWorkspaceConfig: resolvers.loadWorkspaceConfig,
    resolveEntrypoint: resolvers.resolveEntrypoint,
    resolveOptionalStatePath: resolvers.resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir: resolvers.resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath: resolvers.resolveDiscoveredStatePath,
    readJsonObjectFile: resolvers.readJsonObjectFile,
    toWorkspaceDisplayPath: resolvers.toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory: resolvers.resolvePathFromBaseDirectory,
    existsSync: resolvers.existsSync,
    getDeclaredEffectChannels,
    getDeclaredExternals,
    normalizeEffectsPolicy,
    validateDeclaredEffectBindings,
    areJsonStatesEqual,
    hasMeaningfulNextVExecutionEvents,
    normalizeInputEvent,
    startTimerHandles,
    clearTimerHandles,
    runNextVScriptFromFile,
    validateOutputContract,
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    callAgent,
    defaultModel,
  })

  function getLifecycleState() {
    if (runtimeController.isActive()) return 'running'
    return lifecycleState
  }

  async function start(payload = {}) {
    if (runtimeController.isActive()) {
      throw new Error('nextV runtime already active')
    }

    lifecycleState = 'starting'
    lastError = ''
    try {
      const started = await runtimeController.start(payload)
      lifecycleState = 'running'
      return started
    } catch (err) {
      lifecycleState = 'error'
      lastError = String(err?.message ?? err)
      throw err
    }
  }

  function stop() {
    if (!runtimeController.isActive()) {
      throw new Error('nextV runtime not active')
    }

    lifecycleState = 'stopping'
    try {
      const snapshot = runtimeController.stop()
      lifecycleState = 'stopped'
      return snapshot
    } catch (err) {
      lifecycleState = 'error'
      lastError = String(err?.message ?? err)
      throw err
    }
  }

  function enqueue(payload) {
    return runtimeController.enqueue(payload)
  }

  function getSnapshot() {
    return runtimeController.getSnapshot()
  }

  function attachSurface(handler) {
    if (typeof handler !== 'function') {
      throw new Error('attachSurface requires a function handler')
    }
    eventBus.subscribe(handler)
    return () => eventBus.unsubscribe(handler)
  }

  function shutdown() {
    if (runtimeController.isActive()) {
      runtimeController.stop()
    }
    lifecycleState = 'stopped'
  }

  function getStatus() {
    return {
      sessionId,
      state: getLifecycleState(),
      active: runtimeController.isActive(),
      subscribers: eventBus.size,
      workspaceDir: runtimeController.getWorkspaceDir(),
      entrypointPath: runtimeController.getEntrypointPath(),
      lastError,
    }
  }

  return {
    sessionId,
    eventBus,
    runtimeController,
    start,
    stop,
    enqueue,
    getSnapshot,
    attachSurface,
    shutdown,
    getStatus,
    isActive: () => runtimeController.isActive(),
  }
}
