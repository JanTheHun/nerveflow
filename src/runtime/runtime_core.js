import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  NextVEventRunner,
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  buildAgentRetryPrompt,
  buildDecideGuidance,
  buildDecideRetryPrompt,
  normalizeAgentFormattedOutput,
  runNextVScriptFromFile,
  validateAgentReturnContract,
  validateDecideOutput,
  validateOutputContract,
} from '../index.js'

import {
  areJsonStatesEqual,
  clearTimerHandles,
  createEventBus,
  createHostAdapter,
  createNextVRuntimeController,
  getConfiguredAgentProfiles,
  getConfiguredModelsMap,
  getConfiguredModules,
  getDeclaredEffectChannels,
  getDeclaredExternals,
  getRequiredCapabilities,
  hasMeaningfulNextVExecutionEvents,
  loadWorkspaceNextVConfig,
  normalizeEffectsPolicy,
  normalizeInputEvent,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  startTimerHandles,
  validateConfigReferences,
  validateDeclaredEffectBindings,
  validateNoForbiddenAgentFields,
  validateRequiredCapabilityBindings,
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
  toolRuntime = null,
  ingressRuntime = null,
  effectRuntime = null,
  defaultModel = '',
  parallelMaxConcurrency = null,
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
    getRequiredCapabilities,
    getConfiguredModules,
    getDeclaredExternals,
    normalizeEffectsPolicy,
    validateDeclaredEffectBindings,
    validateRequiredCapabilityBindings,
    validateConfigReferences,
    validateNoForbiddenAgentFields,
    areJsonStatesEqual,
    hasMeaningfulNextVExecutionEvents,
    normalizeInputEvent,
    startTimerHandles,
    clearTimerHandles,
    runNextVScriptFromFile,
    validateOutputContract,
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract,
    buildAgentReturnContractGuidance,
    buildAgentRetryPrompt,
    buildDecideGuidance,
    buildDecideRetryPrompt,
    validateDecideOutput,
    toolRuntime,
    ingressRuntime,
    effectRuntime,
    callAgent,
    defaultModel,
    parallelMaxConcurrency,
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

  async function dispatchIngress(payload) {
    return await runtimeController.dispatchIngress(payload)
  }

  function submitCandidate() {
    return runtimeController.submitCandidate()
  }

  function getDefinitionStatus() {
    return runtimeController.getDefinitionStatus()
  }

  function buildResolvedCallSummary({
    targetKind = 'agent',
    target = '',
    prompt = '',
    instructions = '',
    validate = 'coerce',
    retryOnViolation = 0,
    returnsContract = null,
    decideContract = null,
    requestMetadata = null,
  } = {}) {
    const request = requestMetadata && typeof requestMetadata === 'object' ? requestMetadata : {}
    const wirePayload = request.wirePayload && typeof request.wirePayload === 'object'
      ? request.wirePayload
      : {}
    const wireTransport = wirePayload.transport && typeof wirePayload.transport === 'object'
      ? wirePayload.transport
      : {}
    const resolvedModel = String(request.resolvedModel ?? request.model ?? wirePayload.model ?? '').trim()
    const resolvedModelAlias = String(request.resolvedModelAlias ?? '').trim()
    const transportName = String(request.transportName ?? '').trim()
    const transportProvider = String(request.transportProvider ?? wireTransport.provider ?? '').trim()
    const toolNames = Array.isArray(request.toolNames)
      ? request.toolNames.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
    const messageCountRaw = Number(request.messageCount)
    const messageCount = Number.isFinite(messageCountRaw)
      ? Math.max(0, Math.round(messageCountRaw))
      : undefined
    return {
      type: targetKind === 'model' ? 'model_call' : 'agent_call',
      targetKind,
      target: String(request.target ?? target ?? '').trim(),
      resolvedModel,
      ...(resolvedModelAlias && resolvedModelAlias !== resolvedModel ? { resolvedModelAlias } : {}),
      ...(transportName ? { transport: transportName } : {}),
      ...(transportProvider ? { transportProvider } : {}),
      instructions: String(request.instructions ?? instructions ?? '').trim(),
      prompt: String(request.prompt ?? prompt ?? ''),
      ...(typeof messageCount === 'number' ? { messageCount } : {}),
      validate: String(request.validate ?? validate ?? 'coerce').trim() || 'coerce',
      retry_on_contract_violation: Number.isInteger(Number(request.retry_on_contract_violation))
        ? Math.max(0, Math.min(8, Number(request.retry_on_contract_violation)))
        : Math.max(0, Math.min(8, Number(retryOnViolation) || 0)),
      ...(returnsContract != null ? { returns: returnsContract } : {}),
      ...(Array.isArray(decideContract) && decideContract.length > 0 ? { decide: decideContract } : {}),
      ...(toolNames.length > 0 ? { toolNames } : {}),
    }
  }

  async function callInspectorExecute(payload = {}) {
    const targetKindRaw = String(payload?.targetKind ?? 'agent').trim().toLowerCase()
    const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
    const agentName = String(payload?.agent ?? '').trim()
    const modelName = String(payload?.model ?? '').trim()
    const prompt = String(payload?.prompt ?? '')
    const instructions = String(payload?.instructions ?? '')
    const validateModeRaw = String(payload?.validate ?? '').trim().toLowerCase()
    const validateMode = ['strict', 'coerce', 'none'].includes(validateModeRaw) ? validateModeRaw : 'coerce'
    const retryOnViolationRaw = Number(payload?.retry_on_contract_violation)
    const retryOnViolation = Number.isInteger(retryOnViolationRaw)
      ? Math.max(0, Math.min(8, retryOnViolationRaw))
      : 0

    let returnsContract = null
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'returns')) {
      const rawReturns = payload.returns
      if (typeof rawReturns === 'string') {
        const trimmed = rawReturns.trim()
        if (trimmed) {
          try {
            returnsContract = JSON.parse(trimmed)
          } catch {
            throw new Error('returns must be valid JSON when provided as text')
          }
        }
      } else if (rawReturns != null) {
        returnsContract = rawReturns
      }
    }

    let decideContract = null
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'decide')) {
      const rawDecide = payload.decide
      if (Array.isArray(rawDecide)) {
        decideContract = rawDecide.map((value) => String(value ?? '').trim()).filter(Boolean)
      } else if (typeof rawDecide === 'string') {
        decideContract = rawDecide
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      }
      if (Array.isArray(decideContract) && decideContract.length === 0) {
        decideContract = null
      }
    }

    const normalizedMessages = Array.isArray(payload?.messages)
      ? payload.messages
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const role = String(entry.role ?? '').trim()
          const content = String(entry.content ?? '').trim()
          if (!role || !content) return null
          const normalized = { role, content }
          if (Array.isArray(entry.images) && entry.images.length > 0) {
            normalized.images = entry.images.map((value) => String(value ?? '').trim()).filter(Boolean)
          }
          return normalized
        })
        .filter(Boolean)
      : []

    if (targetKind === 'agent' && !agentName) {
      throw new Error('agent target is required when targetKind is "agent"')
    }
    if (targetKind === 'model' && !modelName) {
      throw new Error('model target is required when targetKind is "model"')
    }
    if (!prompt.trim() && normalizedMessages.length === 0) {
      throw new Error('prompt or messages is required')
    }
    if (returnsContract != null && decideContract != null) {
      throw new Error('returns and decide cannot both be set for the same call')
    }

    const runtimeStatus = getStatus()
    const rawWorkspaceDir = String(payload?.workspaceDir ?? runtimeStatus?.workspaceDir ?? '').trim()
    const workspaceDir = resolvers.resolveWorkspaceDirectory(rawWorkspaceDir)
    const workspaceConfig = resolvers.loadWorkspaceConfig(workspaceDir)

    const hostAdapter = createHostAdapter({
      workspaceDir,
      workspaceConfig,
      getWorkspaceConfig: () => workspaceConfig,
      callAgent,
      defaultModel,
      captureAgentRequestPayload: true,
      resolvePathFromBaseDirectory: resolvers.resolvePathFromBaseDirectory,
      existsSync: resolvers.existsSync,
      runNextVScriptFromFile,
      validateOutputContract,
      appendAgentFormatInstructions,
      normalizeAgentFormattedOutput,
      validateAgentReturnContract,
      buildAgentReturnContractGuidance,
      buildAgentRetryPrompt,
      buildDecideGuidance,
      buildDecideRetryPrompt,
      validateDecideOutput,
      toolRuntime,
    })

    const startedAt = Date.now()
    const callResult = await hostAdapter.callAgent({
      agent: targetKind === 'agent' ? agentName : '',
      model: targetKind === 'model' ? modelName : '',
      prompt,
      instructions,
      messages: normalizedMessages,
      returns: returnsContract,
      decide: decideContract,
      validate: validateMode,
      retry_on_contract_violation: retryOnViolation,
      on_contract_violation: {
        source: 'call-inspector',
        mode: 'report',
      },
      state: {},
      locals: {},
      event: {
        type: 'call_inspector.execute',
        source: 'call-inspector',
        value: prompt,
        payload: {},
      },
    })

    const isViolation = callResult && callResult.__nextv_contract_violation__ === true
    const requestMetadata = callResult?.metadata?.request ?? null
    return {
      call: {
        targetKind,
        target: targetKind === 'agent' ? agentName : modelName,
        validate: validateMode,
        retry_on_contract_violation: retryOnViolation,
      },
      resolvedCall: buildResolvedCallSummary({
        targetKind,
        target: targetKind === 'agent' ? agentName : modelName,
        prompt,
        instructions,
        validate: validateMode,
        retryOnViolation,
        returnsContract,
        decideContract,
        requestMetadata,
      }),
      result: {
        value: isViolation ? null : (callResult?.value ?? null),
        metadata: callResult?.metadata ?? null,
        violation: isViolation ? (callResult?.violation ?? null) : null,
        hadContractViolation: isViolation,
      },
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }
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
    dispatchIngress,
    submitCandidate,
    getDefinitionStatus,
    callInspectorExecute,
    getSnapshot,
    attachSurface,
    shutdown,
    getStatus,
    isActive: () => runtimeController.isActive(),
  }
}
