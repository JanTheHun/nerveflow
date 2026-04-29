import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  NextVEventRunner,
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  detectCycles,
  extractEventGraph,
  normalizeAgentFormattedOutput,
  parseNextVScript,
  runNextVScriptFromFile,
  validateAgentReturnContract,
  validateOutputContract,
} from '../src/index.js'
import {
  getConfiguredExternals as getConfiguredExternalsCore,
  getConfiguredModules as getConfiguredModulesCore,
  getDeclaredEffectChannels as getDeclaredEffectChannelsCore,
  getDeclaredExternals as getDeclaredExternalsCore,
  getRequiredCapabilities as getRequiredCapabilitiesCore,
  loadWorkspaceNextVConfig as loadWorkspaceNextVConfigCore,
} from '../src/host_core/workspace_config.js'
import {
  areJsonStatesEqual as areJsonStatesEqualCore,
  hasMeaningfulNextVExecutionEvents as hasMeaningfulNextVExecutionEventsCore,
  normalizeEffectsPolicy as normalizeEffectsPolicyCore,
  validateDeclaredEffectBindings as validateDeclaredEffectBindingsCore,
  validateRequiredCapabilityBindings as validateRequiredCapabilityBindingsCore,
} from '../src/host_core/runtime_policy.js'
import {
  createEffectRealizerRuntime,
  createIngressConnectorRuntime,
  createToolRuntime,
} from '../src/host_core/tool_runtime.js'
import {
  clearTimerHandles,
  normalizeInputEvent as normalizeInputEventCore,
  resolveDiscoveredStatePath as resolveDiscoveredStatePathCore,
  resolveOptionalStatePath as resolveOptionalStatePathCore,
  resolveStateDiscoveryBaseDir as resolveStateDiscoveryBaseDirCore,
  startTimerHandles,
} from '../src/host_core/runtime_lifecycle.js'
import {
  createHostAdapter,
} from '../src/host_core/runtime_session.js'
import {
  createEventBus,
} from '../src/host_core/event_bus.js'
import {
  createNextVRuntimeController,
} from '../src/host_core/runtime_controller.js'
import {
  loadHostModulesByRole,
} from '../src/host_modules/index.js'
import { createMqttRemoteBridge } from './mqtt-remote-bridge.js'
import { createWsRemoteBridge } from './ws-remote-bridge.js'
import { connect as mqttConnect } from 'mqtt'

function parseCliOptions(argv) {
  const options = {
    remote: false,
    remoteMqtt: '',
    remoteMqttTopicPrefix: '',
    remoteWs: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? '').trim()
    if (token === '--remote') {
      options.remote = true
      continue
    }
    if (token === '--remote-mqtt' || token === '--remote-mqtt-topic-prefix' || token === '--remote-ws') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) {
        throw new Error(`${token} requires a value`)
      }
      if (token === '--remote-mqtt') options.remoteMqtt = value
      else if (token === '--remote-ws') options.remoteWs = value
      else options.remoteMqttTopicPrefix = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  return options
}

let cliOptions
try {
  cliOptions = parseCliOptions(process.argv.slice(2))
} catch (err) {
  console.error(`nerve-studio argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const PORT = Number(process.env.PORT || 4173)
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const PUBLIC_DIR = join(__dirname, 'public')
const OLLAMA_DEBUG_LOG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_LOG ?? '').trim())
const OLLAMA_DEBUG_SUMMARY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_SUMMARY ?? '').trim())
const OLLAMA_DEBUG_LOG_PATH = String(process.env.OLLAMA_DEBUG_LOG_PATH ?? '').trim()
  || resolve(REPO_ROOT, 'logs', 'ollama-preview.jsonl')

const MAX_EDITOR_BYTES = 512 * 1024
const MAX_SCRIPT_BYTES = 1024 * 1024
const WORKSPACE_TREE_IGNORED_NAMES = new Set(['.git', 'node_modules', 'logs'])
const ENABLED_SURFACES = parseEnabledSurfaces(process.env.NERVE_STUDIO_SURFACES ?? 'http,sse')
const REMOTE_MODE_REQUESTED = cliOptions.remote === true || Boolean(cliOptions.remoteMqtt) || Boolean(cliOptions.remoteWs)
const REMOTE_MQTT_URL = String(
  (cliOptions.remoteMqtt || (REMOTE_MODE_REQUESTED ? process.env.NERVE_STUDIO_REMOTE_MQTT : '') || '')
).trim()
const REMOTE_WS_URL = String(
  (cliOptions.remoteWs || (REMOTE_MODE_REQUESTED ? process.env.NERVE_STUDIO_REMOTE_WS : '') || '')
).trim()
const REMOTE_MQTT_TOPIC_PREFIX = String(
  cliOptions.remoteMqttTopicPrefix || process.env.NERVE_STUDIO_REMOTE_MQTT_TOPIC_PREFIX || 'nextv/event',
).trim()

if (REMOTE_MQTT_URL && REMOTE_WS_URL) {
  console.error('nerve-studio argument error: remote mode may target either MQTT or WS, not both')
  process.exit(1)
}

if (REMOTE_MODE_REQUESTED && !REMOTE_MQTT_URL && !REMOTE_WS_URL) {
  console.error(
    'nerve-studio argument error: remote mode requires --remote-mqtt <url>, --remote-ws <url>, or matching env fallback (NERVE_STUDIO_REMOTE_MQTT / NERVE_STUDIO_REMOTE_WS)',
  )
  process.exit(1)
}

const REMOTE_MODE = REMOTE_WS_URL
  ? 'ws'
  : (REMOTE_MQTT_URL ? 'mqtt' : 'local')
const isRemoteMode = REMOTE_MODE !== 'local'
const isRemoteControlMode = REMOTE_MODE === 'ws'
const isRemoteObserveOnlyMode = REMOTE_MODE === 'mqtt'
const MANAGED_RUNTIME_PORT = Number(process.env.NERVE_STUDIO_MANAGED_RUNTIME_PORT || 4190)
const MANAGED_RUNTIME_WS_PATH = String(process.env.NERVE_STUDIO_MANAGED_RUNTIME_WS_PATH || '/api/runtime/ws').trim() || '/api/runtime/ws'
const MANAGED_RUNTIME_WS_URL = String(process.env.NERVE_STUDIO_MANAGED_RUNTIME_WS_URL || `ws://127.0.0.1:${MANAGED_RUNTIME_PORT}${MANAGED_RUNTIME_WS_PATH}`).trim()
const MANAGED_RUNTIME_START_TIMEOUT_MS = Number(process.env.NERVE_STUDIO_MANAGED_RUNTIME_START_TIMEOUT_MS || 12000)

const eventBus = createEventBus()
const TIMER_PULSE_REPLAY_WINDOW_MS = 30_000
const TIMER_PULSE_REPLAY_LIMIT = 64
const recentTimerPulses = []
const EXECUTION_REPLAY_WINDOW_MS = 30_000
const EXECUTION_REPLAY_LIMIT = 32
const recentTimerExecutions = []
const RUNTIME_EVENT_REPLAY_WINDOW_MS = 30_000
const RUNTIME_EVENT_REPLAY_LIMIT = 64
const recentTimerRuntimeEvents = []
const ERROR_REPLAY_WINDOW_MS = 30_000
const ERROR_REPLAY_LIMIT = 32
const recentErrors = []

function pruneRecentTimerPulses(now = Date.now()) {
  while (recentTimerPulses.length > 0) {
    const ageMs = now - Number(recentTimerPulses[0]?.timestamp ?? 0)
    if (ageMs <= TIMER_PULSE_REPLAY_WINDOW_MS) break
    recentTimerPulses.shift()
  }
  while (recentTimerPulses.length > TIMER_PULSE_REPLAY_LIMIT) {
    recentTimerPulses.shift()
  }
}

function pruneRecentTimerExecutions(now = Date.now()) {
  while (recentTimerExecutions.length > 0) {
    const ageMs = now - Number(recentTimerExecutions[0]?.timestamp ?? 0)
    if (ageMs <= EXECUTION_REPLAY_WINDOW_MS) break
    recentTimerExecutions.shift()
  }
  while (recentTimerExecutions.length > EXECUTION_REPLAY_LIMIT) {
    recentTimerExecutions.shift()
  }
}

function pruneRecentTimerRuntimeEvents(now = Date.now()) {
  while (recentTimerRuntimeEvents.length > 0) {
    const ageMs = now - Number(recentTimerRuntimeEvents[0]?.timestamp ?? 0)
    if (ageMs <= RUNTIME_EVENT_REPLAY_WINDOW_MS) break
    recentTimerRuntimeEvents.shift()
  }
  while (recentTimerRuntimeEvents.length > RUNTIME_EVENT_REPLAY_LIMIT) {
    recentTimerRuntimeEvents.shift()
  }
}

function pruneRecentErrors(now = Date.now()) {
  while (recentErrors.length > 0) {
    const ageMs = now - Number(recentErrors[0]?.timestamp ?? 0)
    if (ageMs <= ERROR_REPLAY_WINDOW_MS) break
    recentErrors.shift()
  }
  while (recentErrors.length > ERROR_REPLAY_LIMIT) {
    recentErrors.shift()
  }
}

eventBus.subscribe((eventName, payload) => {
  if (eventName === 'nextv_timer_pulse') {
    recentTimerPulses.push({
      timestamp: Date.now(),
      payload,
    })
    pruneRecentTimerPulses()
    return
  }

  if (eventName === 'nextv_execution') {
    const eventSource = String(payload?.event?.source ?? '').trim()
    if (eventSource !== 'timer') return
    recentTimerExecutions.push({
      timestamp: Date.now(),
      payload,
    })
    pruneRecentTimerExecutions()
    return
  }

  if (eventName === 'nextv_runtime_event') {
    const eventSource = String(payload?.event?.source ?? '').trim()
    const runtimeEventType = String(payload?.runtimeEvent?.type ?? '').trim()
    if (eventSource !== 'timer' || runtimeEventType !== 'output') return
    recentTimerRuntimeEvents.push({
      timestamp: Date.now(),
      payload,
    })
    pruneRecentTimerRuntimeEvents()
    return
  }

  if (eventName === 'nextv_error') {
    recentErrors.push({
      timestamp: Date.now(),
      payload,
    })
    pruneRecentErrors()
    return
  }

  if (eventName === 'nextv_stopped') {
    recentTimerExecutions.length = 0
    recentTimerRuntimeEvents.length = 0
    recentErrors.length = 0
    return
  }
})

const wsRemoteBridge = isRemoteControlMode
  ? createWsRemoteBridge({
    wsUrl: REMOTE_WS_URL,
    eventBus,
  })
  : null
const managedWsRemoteBridge = !isRemoteMode
  ? createWsRemoteBridge({
    wsUrl: MANAGED_RUNTIME_WS_URL,
    eventBus,
  })
  : null
let managedRuntimeProcess = null

function resolveRuntimeTarget(url) {
  if (isRemoteObserveOnlyMode) return 'remote-observe'
  if (isRemoteControlMode) return 'remote-control'
  return String(url?.searchParams?.get('runtimeTarget') ?? '').trim().toLowerCase() === 'external'
    ? 'external'
    : 'embedded'
}

function getRuntimeControlBridge(runtimeTarget) {
  if (runtimeTarget === 'remote-control') return wsRemoteBridge
  if (runtimeTarget === 'external') return managedWsRemoteBridge
  return null
}

function waitForBridgeConnection(bridge, timeoutMs) {
  const timeout = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 8000
  return new Promise((resolveWait, rejectWait) => {
    const started = Date.now()
    const tick = () => {
      const status = bridge?.getStatus?.() ?? null
      if (status?.connected === true) {
        resolveWait(status)
        return
      }
      if (Date.now() - started >= timeout) {
        rejectWait(new Error('managed runtime websocket is not connected'))
        return
      }
      setTimeout(tick, 80)
    }
    tick()
  })
}

async function ensureManagedRuntimeProcess(workspaceDirRaw) {
  if (!managedWsRemoteBridge) {
    throw new Error('managed runtime bridge is not configured')
  }

  const bridgeStatus = managedWsRemoteBridge.getStatus()
  if (bridgeStatus.connected) {
    return bridgeStatus
  }

  const workspaceDir = String(workspaceDirRaw ?? '').trim() || '.'
  if (!managedRuntimeProcess || managedRuntimeProcess.exitCode !== null) {
    const runtimeCliPath = resolve(REPO_ROOT, 'bin', 'nerve-runtime.js')
    const childArgs = [
      runtimeCliPath,
      'start',
      workspaceDir,
      '--port',
      String(MANAGED_RUNTIME_PORT),
      '--ws-path',
      MANAGED_RUNTIME_WS_PATH,
      '--no-autostart',
    ]

    const child = spawn(process.execPath, childArgs, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
    })
    managedRuntimeProcess = child

    child.on('exit', () => {
      if (managedRuntimeProcess === child) {
        managedRuntimeProcess = null
      }
    })
  }

  return await waitForBridgeConnection(managedWsRemoteBridge, MANAGED_RUNTIME_START_TIMEOUT_MS)
}

function stopManagedRuntimeProcess() {
  if (!managedRuntimeProcess || managedRuntimeProcess.exitCode !== null) return
  try {
    managedRuntimeProcess.kill()
  } catch {
    // best effort shutdown on host exit
  }
}

if (isRemoteObserveOnlyMode) {
  createMqttRemoteBridge({
    brokerUrl: REMOTE_MQTT_URL,
    topicPrefix: REMOTE_MQTT_TOPIC_PREFIX,
    eventBus,
    createClient: (url) => mqttConnect(url),
  })
}

function buildRemoteModeMetadata(runtimeTarget = 'embedded') {
  if (runtimeTarget === 'embedded' && !isRemoteMode) {
    return {
      remoteMode: false,
      remoteControl: false,
      remoteTransport: 'local',
      remoteRuntimeWorkspaceDir: '',
      remoteRuntimeEntrypointPath: '',
    }
  }

  if (runtimeTarget === 'external') {
    const remoteConnection = managedWsRemoteBridge?.getStatus() ?? null
    return {
      remoteMode: true,
      remoteControl: true,
      remoteTransport: 'ws',
      remoteConnection,
      remoteRuntimeWorkspaceDir: String(remoteConnection?.workspaceDir ?? ''),
      remoteRuntimeEntrypointPath: String(remoteConnection?.entrypointPath ?? ''),
    }
  }

  if (runtimeTarget === 'remote-control') {
    const remoteConnection = wsRemoteBridge?.getStatus() ?? null
    return {
      remoteMode: true,
      remoteControl: true,
      remoteTransport: 'ws',
      remoteConnection,
      remoteRuntimeWorkspaceDir: String(remoteConnection?.workspaceDir ?? ''),
      remoteRuntimeEntrypointPath: String(remoteConnection?.entrypointPath ?? ''),
    }
  }

  if (runtimeTarget === 'remote-observe') {
    return {
      remoteMode: true,
      remoteControl: false,
      remoteTransport: 'mqtt',
      remoteRuntimeWorkspaceDir: '',
      remoteRuntimeEntrypointPath: '',
    }
  }

  return {
    remoteMode: false,
    remoteControl: false,
    remoteTransport: 'local',
    remoteRuntimeWorkspaceDir: '',
    remoteRuntimeEntrypointPath: '',
  }
}

function mapRemoteCommandErrorStatus(errorCode) {
  const code = String(errorCode ?? '').trim().toLowerCase()
  if (code === 'not_active') return 404
  if (code === 'already_active') return 409
  if (code === 'validation_error') return 400
  if (code === 'unavailable') return 503
  if (code === 'policy_denied') return 403
  return 400
}

async function sendRemoteRuntimeCommand(commandType, payload = {}) {
  if (!wsRemoteBridge) {
    throw new Error('remote runtime bridge is not configured')
  }

  const status = wsRemoteBridge.getStatus()
  if (!status.connected) {
    throw new Error('remote runtime websocket is not connected')
  }

  return wsRemoteBridge.sendCommand({
    type: commandType,
    payload,
  })
}

function sendRemoteConnectionUnavailable(res, message = 'remote runtime websocket is not connected', runtimeTarget = 'remote-control') {
  return sendJson(res, 503, {
    ok: false,
    error: message,
    ...buildRemoteModeMetadata(runtimeTarget),
  })
}

function sendRemoteCommandResponse(res, response, fallbackMessage, runtimeTarget = 'remote-control') {
  if (response?.ok === true) {
    return false
  }

  const statusCode = mapRemoteCommandErrorStatus(response?.error?.code)
  sendJson(res, statusCode, {
    ok: false,
    code: String(response?.error?.code ?? 'runtime_error'),
    error: String(response?.error?.message ?? fallbackMessage),
    ...buildRemoteModeMetadata(runtimeTarget),
  })
  return true
}

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.nrv': 'text/plain; charset=utf-8',
  '.wfs': 'text/plain; charset=utf-8',
}

const FILE_KIND_RULES = {
  script: {
    maxBytes: MAX_SCRIPT_BYTES,
    allowedExtensions: new Set(['', '.nrv', '.wfs', '.txt', '.md']),
  },
  editor: {
    maxBytes: MAX_EDITOR_BYTES,
    allowedExtensions: new Set([
      '', '.txt', '.md', '.json', '.jsonc', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
      '.css', '.scss', '.html', '.htm', '.yml', '.yaml', '.toml', '.ini', '.env', '.env.example', '.xml',
      '.sql', '.sh', '.ps1', '.bat', '.cmd', '.nrv', '.wfs',
    ]),
  },
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType })
  res.end(text)
}

function parseEnabledSurfaces(rawValue) {
  const values = String(rawValue ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  return new Set(values)
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let totalSize = 0
    req.on('data', (chunk) => {
      chunks.push(chunk)
      totalSize += chunk.length
      if (totalSize > 10 * 1024 * 1024) {
        rejectBody(new Error('Request body too large'))
      }
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolveBody({})
      try {
        resolveBody(JSON.parse(raw))
      } catch {
        rejectBody(new Error('Invalid JSON body'))
      }
    })
    req.on('error', (err) => rejectBody(err))
  })
}

function safePublicPath(urlPath) {
  const clean = normalize(urlPath).replace(/^([\\/])+/, '')
  const fullPath = join(PUBLIC_DIR, clean)
  if (!fullPath.startsWith(PUBLIC_DIR)) return null
  return fullPath
}

function getKindRules(kindRaw) {
  const kind = String(kindRaw ?? '').trim().toLowerCase()
  if (!kind || kind === 'editor') return FILE_KIND_RULES.editor
  if (kind === 'script') return FILE_KIND_RULES.script
  return null
}

function getExtensionKey(filePath) {
  const base = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base === '.env') return '.env'
  if (base === '.env.example') return '.env.example'
  return extname(filePath).toLowerCase()
}

function getMimeTypeForPath(filePath) {
  return MIME_BY_EXT[getExtensionKey(filePath)] || 'application/octet-stream'
}

function resolveWorkspaceDirectory(inputPath) {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) {
    return { absolutePath: REPO_ROOT, relativePath: '.' }
  }
  if (isAbsolute(candidate)) {
    throw new Error('Only workspace-relative paths are allowed')
  }
  const absolutePath = resolve(REPO_ROOT, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }
  return {
    absolutePath,
    relativePath: rel ? rel.replace(/\\/g, '/') : '.',
  }
}

function resolveWorkspaceRelativePath(inputPath, kindRaw = 'editor') {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) throw new Error('filePath required')
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

  const rules = getKindRules(kindRaw)
  if (!rules) throw new Error('Invalid file kind')

  const absolutePath = resolve(REPO_ROOT, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }

  const extension = getExtensionKey(absolutePath)
  if (!rules.allowedExtensions.has(extension)) {
    throw new Error(`Unsupported extension '${extension}' for ${kindRaw || 'editor'}`)
  }

  return {
    absolutePath,
    relativePath: rel.replace(/\\/g, '/'),
    rules,
  }
}

function readWorkspaceTextFile(filePath, kind) {
  const resolvedFile = resolveWorkspaceRelativePath(filePath, kind)
  const stats = statSync(resolvedFile.absolutePath)
  if (!stats.isFile()) throw new Error('Path is not a file')
  if (stats.size > resolvedFile.rules.maxBytes) throw new Error('File is too large')

  const content = readFileSync(resolvedFile.absolutePath, 'utf8')
  return {
    ...resolvedFile,
    content,
    bytes: Buffer.byteLength(content, 'utf8'),
    lastModified: stats.mtimeMs,
    mimeType: getMimeTypeForPath(resolvedFile.absolutePath),
  }
}

function shouldIgnoreWorkspaceTreeEntry(name) {
  const normalizedName = String(name ?? '').trim().toLowerCase()
  if (!normalizedName) return true
  if (normalizedName === '.env') return true
  return WORKSPACE_TREE_IGNORED_NAMES.has(normalizedName)
}

function buildWorkspaceTree(directoryAbsolutePath, directoryRelativePath = '.') {
  const entries = readdirSync(directoryAbsolutePath, { withFileTypes: true })
    .filter((entry) => !shouldIgnoreWorkspaceTreeEntry(entry.name))
    .map((entry) => {
      const childAbsolutePath = join(directoryAbsolutePath, entry.name)
      const childRelativePath = directoryRelativePath === '.'
        ? entry.name
        : `${directoryRelativePath}/${entry.name}`

      if (entry.isDirectory()) {
        return {
          type: 'dir',
          name: entry.name,
          path: childRelativePath.replace(/\\/g, '/'),
          children: buildWorkspaceTree(childAbsolutePath, childRelativePath),
        }
      }

      return {
        type: 'file',
        name: entry.name,
        path: childRelativePath.replace(/\\/g, '/'),
        ext: getExtensionKey(entry.name),
      }
    })

  entries.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return left.name.localeCompare(right.name)
  })

  return entries
}

function sseEvent(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}

function toWorkspaceDisplayPath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath
  return rel.replace(/\\/g, '/')
}

function readJsonObjectFile(filePath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (err) {
    throw new Error(`Could not parse JSON at ${toWorkspaceDisplayPath(filePath)}: ${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`JSON at ${toWorkspaceDisplayPath(filePath)} must be an object`)
  }
  return parsed
}

function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
  const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
  const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
  if (!rawEntrypoint) {
    throw new Error('entrypointPath required (or set nextv.json entrypointPath)')
  }

  const joined = join(workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath, rawEntrypoint)
  const entrypoint = resolveWorkspaceRelativePath(joined.replace(/\\/g, '/'), 'script')

  if (!existsSync(entrypoint.absolutePath)) {
    throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
  }

  return entrypoint
}

function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) throw new Error('filePath required')
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

  const rules = getKindRules(kindRaw)
  if (!rules) throw new Error('Invalid file kind')

  const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }

  const extension = getExtensionKey(absolutePath)
  if (!rules.allowedExtensions.has(extension)) {
    throw new Error(`Unsupported extension '${extension}' for ${kindRaw || 'editor'}`)
  }

  return {
    absolutePath,
    relativePath: rel.replace(/\\/g, '/'),
    rules,
  }
}

async function callOllamaAgent({ model, messages }) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const requestPayload = {
    model,
    messages,
    stream: false,
  }

  appendOllamaDebugRecord({
    source: 'preview-server',
    phase: 'request',
    url: `${baseUrl}/api/chat`,
    payload: requestPayload,
  })

  let response
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    })
  } catch (err) {
    appendOllamaDebugRecord({
      source: 'preview-server',
      phase: 'fetch_error',
      url: `${baseUrl}/api/chat`,
      error: String(err?.message ?? err),
    })
    throw err
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    appendOllamaDebugRecord({
      source: 'preview-server',
      phase: 'response',
      ok: false,
      status: response.status,
      statusText: response.statusText,
      bodyText,
    })
    throw new Error(`Ollama chat failed (${response.status}): ${bodyText || response.statusText}`)
  }

  const payload = await response.json()
  appendOllamaDebugRecord({
    source: 'preview-server',
    phase: 'response',
    ok: true,
    status: response.status,
    payload,
  })

  const promptTokens = Number.isFinite(Number(payload?.prompt_eval_count))
    ? Number(payload.prompt_eval_count)
    : null
  const completionTokens = Number.isFinite(Number(payload?.eval_count))
    ? Number(payload.eval_count)
    : null
  const totalTokens = (
    Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
      ? promptTokens + completionTokens
      : null
  )

  return {
    text: String(payload?.message?.content ?? payload?.response ?? '').trim(),
    metadata: {
      provider: 'ollama',
      model: String(model ?? payload?.model ?? '').trim(),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
      },
      timings: {
        totalDurationNs: Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : null,
        loadDurationNs: Number.isFinite(Number(payload?.load_duration)) ? Number(payload.load_duration) : null,
        promptEvalDurationNs: Number.isFinite(Number(payload?.prompt_eval_duration)) ? Number(payload.prompt_eval_duration) : null,
        evalDurationNs: Number.isFinite(Number(payload?.eval_duration)) ? Number(payload.eval_duration) : null,
      },
      rawProvider: {
        createdAt: String(payload?.created_at ?? ''),
        doneReason: String(payload?.done_reason ?? ''),
        prompt_eval_count: Number.isFinite(Number(payload?.prompt_eval_count)) ? Number(payload.prompt_eval_count) : null,
        eval_count: Number.isFinite(Number(payload?.eval_count)) ? Number(payload.eval_count) : null,
        prompt_eval_duration: Number.isFinite(Number(payload?.prompt_eval_duration)) ? Number(payload.prompt_eval_duration) : null,
        eval_duration: Number.isFinite(Number(payload?.eval_duration)) ? Number(payload.eval_duration) : null,
        total_duration: Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : null,
        load_duration: Number.isFinite(Number(payload?.load_duration)) ? Number(payload.load_duration) : null,
      },
    },
  }
}

function previewDebugText(value, maxLength = 240) {
  const text = String(value ?? '')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function summarizeDebugValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => summarizeDebugValue(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const summary = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'messages' && Array.isArray(entry)) {
      summary.messages = entry.map((message) => {
        const base = {
          role: String(message?.role ?? ''),
          contentLength: String(message?.content ?? '').length,
          contentPreview: previewDebugText(message?.content ?? ''),
        }
        if (Array.isArray(message?.images)) {
          base.imageCount = message.images.length
          base.imageLengths = message.images.map((image) => String(image ?? '').length)
        }
        return base
      })
      continue
    }

    if (key === 'bodyText') {
      summary.bodyTextLength = String(entry ?? '').length
      summary.bodyTextPreview = previewDebugText(entry ?? '')
      continue
    }

    if (typeof entry === 'string') {
      summary[key] = entry.length > 400
        ? { length: entry.length, preview: previewDebugText(entry, 240) }
        : entry
      continue
    }

    summary[key] = summarizeDebugValue(entry)
  }

  return summary
}

function appendOllamaDebugRecord(record) {
  if (!OLLAMA_DEBUG_LOG_ENABLED) return
  try {
    const payload = OLLAMA_DEBUG_SUMMARY_ENABLED
      ? summarizeDebugValue(record)
      : record
    mkdirSync(dirname(OLLAMA_DEBUG_LOG_PATH), { recursive: true })
    appendFileSync(OLLAMA_DEBUG_LOG_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...payload })}\n`, 'utf8')
  } catch {
    // Debug logging must never break runtime agent calls.
  }
}

let activeToolRuntime = createToolRuntime({ providers: [] })
let activeIngressRuntime = createIngressConnectorRuntime({ connectors: [] })
let activeEffectRuntime = createEffectRealizerRuntime({ realizers: [] })
let activeHostModulesSummary = {
  toolProviders: 0,
  ingressConnectors: 0,
  effectRealizers: 0,
  workspaceDir: '.',
}

async function configureRuntimeHostModules(workspaceDirValueRaw) {
  const workspaceDir = resolveWorkspaceDirectory(workspaceDirValueRaw)
  const roles = await loadHostModulesByRole({ workspaceDir: workspaceDir.absolutePath })
  activeToolRuntime = createToolRuntime({ providers: roles.toolProviders })
  activeIngressRuntime = createIngressConnectorRuntime({ connectors: roles.ingressConnectors })
  activeEffectRuntime = createEffectRealizerRuntime({ realizers: roles.effectRealizers })
  activeHostModulesSummary = {
    toolProviders: Array.isArray(roles.toolProviders) ? roles.toolProviders.length : 0,
    ingressConnectors: Array.isArray(roles.ingressConnectors) ? roles.ingressConnectors.length : 0,
    effectRealizers: Array.isArray(roles.effectRealizers) ? roles.effectRealizers.length : 0,
    workspaceDir: workspaceDir.relativePath,
  }
  return activeHostModulesSummary
}

const dynamicToolRuntime = {
  call: async (payload = {}) => activeToolRuntime.call(payload),
}

const dynamicIngressRuntime = {
  dispatch: async (payload = {}) => activeIngressRuntime.dispatch(payload),
}

const dynamicEffectRuntime = {
  realize: async (payload = {}) => activeEffectRuntime.realize(payload),
}

const runtimeController = createNextVRuntimeController({
  eventBus,
  createRunner: (options) => new NextVEventRunner(options),
  createHostAdapter,
  resolveWorkspaceDirectory,
  loadWorkspaceConfig: (workspaceDir) => loadWorkspaceNextVConfigCore({
    workspaceDir,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    readJsonObjectFile,
  }),
  resolveEntrypoint,
  resolveOptionalStatePath: resolveOptionalStatePathCore,
  resolveStateDiscoveryBaseDir: resolveStateDiscoveryBaseDirCore,
  resolveDiscoveredStatePath: resolveDiscoveredStatePathCore,
  readJsonObjectFile,
  toWorkspaceDisplayPath,
  resolvePathFromBaseDirectory,
  existsSync,
  getDeclaredEffectChannels: getDeclaredEffectChannelsCore,
  getRequiredCapabilities: getRequiredCapabilitiesCore,
  getConfiguredModules: getConfiguredModulesCore,
  getDeclaredExternals: getDeclaredExternalsCore,
  normalizeEffectsPolicy: normalizeEffectsPolicyCore,
  validateDeclaredEffectBindings: validateDeclaredEffectBindingsCore,
  validateRequiredCapabilityBindings: validateRequiredCapabilityBindingsCore,
  areJsonStatesEqual: areJsonStatesEqualCore,
  hasMeaningfulNextVExecutionEvents: hasMeaningfulNextVExecutionEventsCore,
  normalizeInputEvent: normalizeInputEventCore,
  startTimerHandles,
  clearTimerHandles,
  runNextVScriptFromFile,
  validateOutputContract,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  validateAgentReturnContract,
  buildAgentReturnContractGuidance,
  toolRuntime: dynamicToolRuntime,
  ingressRuntime: dynamicIngressRuntime,
  effectRuntime: dynamicEffectRuntime,
  callAgent: callOllamaAgent,
  defaultModel: process.env.OLLAMA_MODEL ?? '',
})

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/session') {
    return sendJson(res, 200, { model: '', imageCount: 0 })
  }

  if (req.method === 'GET' && url.pathname === '/api/workspace/tree') {
    const workspaceDirValue = String(url.searchParams.get('workspaceDir') ?? '').trim()
    try {
      const workspaceDir = resolveWorkspaceDirectory(workspaceDirValue)
      const stats = statSync(workspaceDir.absolutePath)
      if (!stats.isDirectory()) {
        return sendJson(res, 400, { error: 'workspaceDir must be a directory' })
      }
      const children = buildWorkspaceTree(workspaceDir.absolutePath, workspaceDir.relativePath)
      return sendJson(res, 200, { ok: true, root: workspaceDir.relativePath, children })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not load workspace tree: ${err.message}` })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/script/content') {
    const filePath = String(url.searchParams.get('filePath') ?? '').trim()
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })
    try {
      const { content, relativePath } = readWorkspaceTextFile(filePath, 'script')
      return sendJson(res, 200, {
        ok: true,
        filePath: relativePath,
        lines: content.replace(/\r\n/g, '\n').split('\n'),
      })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not read script file: ${err.message}` })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/file/content') {
    const filePath = String(url.searchParams.get('filePath') ?? '').trim()
    const kind = String(url.searchParams.get('kind') ?? '').trim()
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })
    try {
      const { content, relativePath, bytes, lastModified, mimeType } = readWorkspaceTextFile(filePath, kind)
      return sendJson(res, 200, {
        ok: true,
        filePath: relativePath,
        content,
        lines: content.replace(/\r\n/g, '\n').split('\n'),
        bytes,
        lastModified,
        mimeType,
        kind,
      })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not load file: ${err.message}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/file/save') {
    const body = await readRequestBody(req)
    const filePath = String(body.filePath ?? '').trim()
    const kind = String(body.kind ?? '').trim()
    const content = String(body.content ?? '')
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })

    try {
      const { absolutePath, relativePath, rules } = resolveWorkspaceRelativePath(filePath, kind)
      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > rules.maxBytes) return sendJson(res, 400, { error: 'Content is too large' })
      mkdirSync(dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, content, 'utf8')
      const stats = statSync(absolutePath)
      return sendJson(res, 200, {
        ok: true,
        filePath: relativePath,
        kind,
        bytes,
        lastModified: stats.mtimeMs,
        mimeType: getMimeTypeForPath(absolutePath),
      })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not save file: ${err.message}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/file/create') {
    const body = await readRequestBody(req)
    const filePath = String(body.filePath ?? '').trim()
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })

    try {
      const { absolutePath, relativePath } = resolveWorkspaceRelativePath(filePath, 'editor')
      if (existsSync(absolutePath)) return sendJson(res, 409, { error: 'File already exists' })
      mkdirSync(dirname(absolutePath), { recursive: true })
      writeFileSync(absolutePath, '', 'utf8')
      return sendJson(res, 200, { ok: true, filePath: relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not create file: ${err.message}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/folder/create') {
    const body = await readRequestBody(req)
    const folderPath = String(body.folderPath ?? '').trim()
    if (!folderPath) return sendJson(res, 400, { error: 'folderPath required' })

    try {
      const { absolutePath, relativePath } = resolveWorkspaceDirectory(folderPath)
      if (relativePath === '.') return sendJson(res, 400, { error: 'Cannot create workspace root' })
      if (existsSync(absolutePath)) return sendJson(res, 409, { error: 'Folder already exists' })
      mkdirSync(absolutePath)
      return sendJson(res, 200, { ok: true, folderPath: relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not create folder: ${err.message}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/file/rename') {
    const body = await readRequestBody(req)
    const filePath = String(body.filePath ?? '').trim()
    const newName = String(body.newName ?? '').trim()
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })
    if (!newName) return sendJson(res, 400, { error: 'newName required' })
    if (/[/\\]/.test(newName)) return sendJson(res, 400, { error: 'newName must not contain path separators' })

    try {
      const source = resolveWorkspaceRelativePath(filePath, 'editor')
      if (!existsSync(source.absolutePath)) return sendJson(res, 404, { error: 'File not found' })

      const parentPath = source.relativePath.includes('/')
        ? source.relativePath.slice(0, source.relativePath.lastIndexOf('/'))
        : ''
      const targetPath = parentPath ? `${parentPath}/${newName}` : newName
      const target = resolveWorkspaceRelativePath(targetPath, 'editor')

      if (target.absolutePath === source.absolutePath) {
        return sendJson(res, 200, { ok: true, oldPath: source.relativePath, filePath: target.relativePath })
      }
      if (existsSync(target.absolutePath)) return sendJson(res, 409, { error: 'Target already exists' })

      renameSync(source.absolutePath, target.absolutePath)
      return sendJson(res, 200, { ok: true, oldPath: source.relativePath, filePath: target.relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not rename file: ${err.message}` })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/folder/rename') {
    const body = await readRequestBody(req)
    const folderPath = String(body.folderPath ?? '').trim()
    const newName = String(body.newName ?? '').trim()
    if (!folderPath) return sendJson(res, 400, { error: 'folderPath required' })
    if (!newName) return sendJson(res, 400, { error: 'newName required' })
    if (/[/\\]/.test(newName)) return sendJson(res, 400, { error: 'newName must not contain path separators' })

    try {
      const source = resolveWorkspaceDirectory(folderPath)
      if (source.relativePath === '.') return sendJson(res, 400, { error: 'Cannot rename workspace root' })
      if (!existsSync(source.absolutePath)) return sendJson(res, 404, { error: 'Folder not found' })

      const parentPath = source.relativePath.includes('/')
        ? source.relativePath.slice(0, source.relativePath.lastIndexOf('/'))
        : ''
      const targetPath = parentPath ? `${parentPath}/${newName}` : newName
      const target = resolveWorkspaceDirectory(targetPath)

      if (target.absolutePath === source.absolutePath) {
        return sendJson(res, 200, { ok: true, oldPath: source.relativePath, folderPath: target.relativePath })
      }
      if (existsSync(target.absolutePath)) return sendJson(res, 409, { error: 'Target already exists' })

      renameSync(source.absolutePath, target.absolutePath)
      return sendJson(res, 200, { ok: true, oldPath: source.relativePath, folderPath: target.relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not rename folder: ${err.message}` })
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/file') {
    const body = await readRequestBody(req)
    const filePath = String(body.filePath ?? '').trim()
    const kind = String(body.kind ?? '').trim() || 'editor'
    if (!filePath) return sendJson(res, 400, { error: 'filePath required' })

    try {
      const { absolutePath, relativePath } = resolveWorkspaceRelativePath(filePath, kind)
      if (!existsSync(absolutePath)) return sendJson(res, 404, { error: 'File not found' })
      unlinkSync(absolutePath)
      return sendJson(res, 200, { ok: true, filePath: relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not delete file: ${err.message}` })
    }
  }

  if (req.method === 'DELETE' && url.pathname === '/api/folder') {
    const body = await readRequestBody(req)
    const folderPath = String(body.folderPath ?? '').trim()
    if (!folderPath) return sendJson(res, 400, { error: 'folderPath required' })

    try {
      const { absolutePath, relativePath } = resolveWorkspaceDirectory(folderPath)
      if (relativePath === '.') return sendJson(res, 400, { error: 'Cannot delete workspace root' })
      if (!existsSync(absolutePath)) return sendJson(res, 404, { error: 'Folder not found' })
      rmSync(absolutePath, { recursive: true, force: false })
      return sendJson(res, 200, { ok: true, folderPath: relativePath })
    } catch (err) {
      return sendJson(res, 400, { error: `Could not delete folder: ${err.message}` })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/nextv/workspace-config') {
    const rawWorkspaceDir = String(url.searchParams.get('workspaceDir') ?? '').trim()
    try {
      const workspaceDir = resolveWorkspaceDirectory(rawWorkspaceDir)
      const workspaceConfig = loadWorkspaceNextVConfigCore({
        workspaceDir,
        toWorkspaceDisplayPath,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      })
      const declaredExternals = getConfiguredExternalsCore(workspaceConfig)
      const declaredEffects = Object.keys(getDeclaredEffectChannelsCore(workspaceConfig))
      return sendJson(res, 200, {
        ok: true,
        entrypointPath: String(workspaceConfig.nextv.config?.entrypointPath ?? '').trim(),
        baselineStatePath: String(workspaceConfig.nextv.config?.baselineStatePath ?? '').trim(),
        declaredExternals,
        declaredEffects,
        timers: Array.isArray(workspaceConfig.nextv.timers)
          ? workspaceConfig.nextv.timers.map((timer) => ({
              event: timer.event,
              interval: timer.interval,
              payload: timer.payload,
              runOnStart: timer.runOnStart === true,
            }))
          : [],
      })
    } catch (err) {
      return sendJson(res, 400, { error: `Failed to load workspace config: ${err.message}` })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/nextv/graph') {
    const rawWorkspaceDir = String(url.searchParams.get('workspaceDir') ?? '').trim()
    const requestedEntrypointPath = String(url.searchParams.get('entrypointPath') ?? '').trim()

    let workspaceDir
    let workspaceConfig
    let entrypoint

    try {
      workspaceDir = resolveWorkspaceDirectory(rawWorkspaceDir)
      workspaceConfig = loadWorkspaceNextVConfigCore({
        workspaceDir,
        toWorkspaceDisplayPath,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      })
      entrypoint = resolveEntrypoint(workspaceDir, requestedEntrypointPath, workspaceConfig)
    } catch (err) {
      return sendJson(res, 400, { error: String(err.message || err) })
    }

    try {
      const source = readFileSync(entrypoint.absolutePath, 'utf8')
      const ast = parseNextVScript(source, {
        baseDir: dirname(entrypoint.absolutePath),
        filePath: entrypoint.absolutePath,
      })
      const configExternals = getDeclaredExternalsCore(workspaceConfig)
      const graph = extractEventGraph(ast, { declaredExternals: configExternals })
      const wsAbsDir = workspaceDir.absolutePath
      for (const node of graph.nodes) {
        if (node.sourcePath && !node.sourcePath.startsWith('(')) {
          node.sourcePath = relative(wsAbsDir, node.sourcePath).replace(/\\/g, '/')
        }
      }
      for (const edge of (Array.isArray(graph.controlEdges) ? graph.controlEdges : [])) {
        if (edge?.sourcePath && !String(edge.sourcePath).startsWith('(')) {
          edge.sourcePath = relative(wsAbsDir, edge.sourcePath).replace(/\\/g, '/')
        }
      }
      const { cycles } = detectCycles(graph)
      const timerNodes = workspaceConfig.nextv.timers.map((timer) => ({
        id: `timer:${timer.event}`,
        kind: 'timer',
        eventType: timer.event,
        interval: Number(timer.interval),
        runOnStart: timer.runOnStart === true,
        sourcePath: '(host:timers)',
      }))

      return sendJson(res, 200, {
        ok: true,
        workspaceDir: workspaceDir.relativePath,
        entrypointPath: relative(wsAbsDir, entrypoint.absolutePath).replace(/\\/g, '/'),
        nodes: graph.nodes,
        edges: graph.edges,
        controlEdges: graph.controlEdges,
        transitions: graph.transitions,
        cycles,
        ignoredDynamicEmits: graph.ignoredDynamicEmits,
        contractWarnings: graph.contractWarnings,
        timerNodes,
        declaredExternals: graph.declaredExternals,
      })
    } catch (err) {
      return sendJson(res, 400, {
        error: String(err?.message ?? 'Failed to extract nextV graph'),
        line: Number.isFinite(Number(err?.line)) ? Number(err.line) : null,
        kind: String(err?.kind ?? ''),
        code: String(err?.code ?? ''),
        statement: String(err?.statement ?? ''),
      })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/run') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 405, { error: 'nerve-studio is in remote observability mode; runtime control is disabled' })
    }
    if (runtimeTarget !== 'external') {
      return sendJson(res, 400, { error: 'run endpoint is only for external runtime mode' })
    }

    let body
    try {
      body = await readRequestBody(req)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }

    try {
      await ensureManagedRuntimeProcess(body?.workspaceDir)
      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      const status = runtimeBridge.getStatus()
      return sendJson(res, 200, {
        ok: true,
        connected: status.connected,
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    } catch (err) {
      return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/kill') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget !== 'external') {
      return sendJson(res, 400, { error: 'kill endpoint is only for external runtime mode' })
    }
    stopManagedRuntimeProcess()
    return sendJson(res, 200, { ok: true, ...buildRemoteModeMetadata(runtimeTarget) })
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/start') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 405, { error: 'nerve-studio is in remote observability mode; runtime control is disabled' })
    }
    let body
    try {
      body = await readRequestBody(req)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }

    if (runtimeTarget === 'external') {
      // External mode: assume process is already running from /api/nextv/run
      // Just send the start command; don't spawn process here
    }

    if (runtimeTarget === 'remote-control' || runtimeTarget === 'external') {
      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      let response
      try {
        if (!runtimeBridge?.sendCommand) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime bridge is not configured', runtimeTarget)
        }
        const status = runtimeBridge.getStatus()
        if (!status.connected) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime websocket is not connected', runtimeTarget)
        }
        response = await runtimeBridge.sendCommand({ type: 'start', payload: body })
      } catch (err) {
        return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
      }

      const errorResponse = sendRemoteCommandResponse(res, response, 'failed to start remote runtime', runtimeTarget)
      if (errorResponse) return errorResponse

      return sendJson(res, 200, {
        ok: true,
        ...(response?.data ?? {}),
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    }

    try {
      const hostModules = await configureRuntimeHostModules(body?.workspaceDir)
      const runtimeStarted = await runtimeController.start(body)
      return sendJson(res, 200, {
        ok: true,
        ...runtimeStarted,
        hostModules,
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    } catch (err) {
      return sendJson(res, 400, { error: String(err?.message ?? err) })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/stop') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 405, { error: 'nerve-studio is in remote observability mode; runtime control is disabled' })
    }
    if (runtimeTarget === 'remote-control' || runtimeTarget === 'external') {
      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      let response
      try {
        if (!runtimeBridge?.sendCommand) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime bridge is not configured', runtimeTarget)
        }
        const status = runtimeBridge.getStatus()
        if (!status.connected) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime websocket is not connected', runtimeTarget)
        }
        response = await runtimeBridge.sendCommand({ type: 'stop', payload: {} })
      } catch (err) {
        return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
      }

      const errorResponse = sendRemoteCommandResponse(res, response, 'failed to stop remote runtime', runtimeTarget)
      if (errorResponse) return errorResponse

      // Kill managed process in external mode so next start spawns fresh
      if (runtimeTarget === 'external') {
        stopManagedRuntimeProcess()
      }

      return sendJson(res, 200, {
        ok: true,
        snapshot: response?.data?.snapshot ?? null,
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    }

    if (!runtimeController.isActive()) {
      return sendJson(res, 404, { error: 'nextV runtime not active' })
    }

    const snapshot = runtimeController.stop()
    return sendJson(res, 200, { ok: true, snapshot })
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/event') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 405, { error: 'nerve-studio is in remote observability mode; runtime control is disabled' })
    }
    if (runtimeTarget === 'remote-control' || runtimeTarget === 'external') {
      let body
      try {
        body = await readRequestBody(req)
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }

      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      let response
      try {
        if (!runtimeBridge?.sendCommand) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime bridge is not configured', runtimeTarget)
        }
        const status = runtimeBridge.getStatus()
        if (!status.connected) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime websocket is not connected', runtimeTarget)
        }
        response = await runtimeBridge.sendCommand({ type: 'enqueue_event', payload: body })
      } catch (err) {
        return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
      }

      const errorResponse = sendRemoteCommandResponse(res, response, 'failed to enqueue remote event', runtimeTarget)
      if (errorResponse) return errorResponse

      return sendJson(res, 200, {
        ok: true,
        snapshot: response?.data?.snapshot ?? null,
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    }

    if (!runtimeController.isActive()) {
      return sendJson(res, 404, { error: 'nextV runtime not active' })
    }

    let body
    try {
      body = await readRequestBody(req)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }

    try {
      const { snapshot } = runtimeController.enqueue(body)
      return sendJson(res, 200, { ok: true, snapshot })
    } catch (err) {
      return sendJson(res, 400, { error: String(err?.message ?? err) })
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/nextv/ingress') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 405, { error: 'nerve-studio is in remote observability mode; runtime control is disabled' })
    }
    if (runtimeTarget === 'remote-control' || runtimeTarget === 'external') {
      let body
      try {
        body = await readRequestBody(req)
      } catch (err) {
        return sendJson(res, 400, { error: err.message })
      }

      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      let response
      try {
        if (!runtimeBridge?.sendCommand) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime bridge is not configured', runtimeTarget)
        }
        const status = runtimeBridge.getStatus()
        if (!status.connected) {
          return sendRemoteConnectionUnavailable(res, 'remote runtime websocket is not connected', runtimeTarget)
        }
        response = await runtimeBridge.sendCommand({ type: 'dispatch_ingress', payload: body })
      } catch (err) {
        return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
      }

      const errorResponse = sendRemoteCommandResponse(res, response, 'failed to dispatch remote ingress', runtimeTarget)
      if (errorResponse) return errorResponse

      return sendJson(res, 200, {
        ok: true,
        ...(response?.data ?? {}),
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    }

    if (!runtimeController.isActive()) {
      return sendJson(res, 404, { error: 'nextV runtime not active' })
    }

    let body
    try {
      body = await readRequestBody(req)
    } catch (err) {
      return sendJson(res, 400, { error: err.message })
    }

    try {
      const dispatched = await runtimeController.dispatchIngress(body)
      return sendJson(res, 200, { ok: true, ...dispatched })
    } catch (err) {
      return sendJson(res, 400, { error: String(err?.message ?? err) })
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/nextv/snapshot') {
    const runtimeTarget = resolveRuntimeTarget(url)
    if (runtimeTarget === 'remote-observe') {
      return sendJson(res, 200, {
        ok: true,
        running: false,
        snapshot: null,
        ...buildRemoteModeMetadata(runtimeTarget),
      })
    }

    if (runtimeTarget === 'remote-control' || runtimeTarget === 'external') {
      const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
      if (!runtimeBridge) {
        return sendRemoteConnectionUnavailable(res, 'remote runtime bridge is not configured', runtimeTarget)
      }

      try {
        const snapshot = await runtimeBridge.requestSnapshot()
        return sendJson(res, 200, {
          ok: true,
          running: snapshot.running === true,
          snapshot: snapshot.snapshot,
          ...buildRemoteModeMetadata(runtimeTarget),
        })
      } catch (err) {
        const cachedSnapshot = runtimeBridge.getCachedSnapshot()
        if (cachedSnapshot) {
          return sendJson(res, 200, {
            ok: true,
            running: cachedSnapshot.running === true,
            snapshot: cachedSnapshot,
            staleSnapshot: true,
            warning: String(err?.message ?? err),
            ...buildRemoteModeMetadata(runtimeTarget),
          })
        }
        return sendRemoteConnectionUnavailable(res, String(err?.message ?? err), runtimeTarget)
      }
    }

    const snapshot = runtimeController.getSnapshot()
    return sendJson(res, 200, {
      ok: true,
      running: snapshot?.running === true,
      snapshot,
      ...buildRemoteModeMetadata(runtimeTarget),
    })
  }

  if (req.method === 'GET' && url.pathname === '/api/nextv/stream') {
    const runtimeTarget = resolveRuntimeTarget(url)
    const runtimeBridge = getRuntimeControlBridge(runtimeTarget)
    if (!ENABLED_SURFACES.has('sse')) {
      return sendJson(res, 404, {
        error: 'SSE surface is disabled for this host.',
      })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    const connectionTime = Date.now()
    const sseHandler = (eventName, payload) => {
      try {
        sseEvent(res, eventName, payload)
      } catch {
        eventBus.unsubscribe(sseHandler)
        try { res.end() } catch {}
      }
    }
    eventBus.subscribe(sseHandler)
    sseEvent(res, 'nextv_stream_open', {
      ok: true,
      timestamp: new Date().toISOString(),
      active: runtimeBridge
        ? (runtimeBridge.getStatus()?.remoteActive === true)
        : runtimeController.isActive(),
    })

    const replayTimer = setTimeout(() => {
      const now = Date.now()
      pruneRecentTimerPulses(now)
      pruneRecentTimerExecutions(now)
      pruneRecentTimerRuntimeEvents(now)
      pruneRecentErrors(now)
      for (const entry of recentTimerPulses) {
        if (entry.timestamp >= connectionTime) continue
        try {
          sseEvent(res, 'nextv_timer_pulse', entry.payload)
        } catch {
          break
        }
      }
      for (const entry of recentTimerExecutions) {
        if (entry.timestamp >= connectionTime) continue
        try {
          sseEvent(res, 'nextv_execution', entry.payload)
        } catch {
          break
        }
      }
      for (const entry of recentTimerRuntimeEvents) {
        if (entry.timestamp >= connectionTime) continue
        try {
          sseEvent(res, 'nextv_runtime_event', entry.payload)
        } catch {
          break
        }
      }
      for (const entry of recentErrors) {
        if (entry.timestamp >= connectionTime) continue
        try {
          sseEvent(res, 'nextv_error', entry.payload)
        } catch {
          break
        }
      }
    }, 40)

    const activeSnapshot = runtimeBridge
      ? (runtimeBridge.getCachedSnapshot() ?? null)
      : runtimeController.getActiveSnapshot()
    if (activeSnapshot) {
      sseEvent(res, 'nextv_snapshot', { snapshot: activeSnapshot })
    }

    req.on('close', () => {
      clearTimeout(replayTimer)
      eventBus.unsubscribe(sseHandler)
    })
    return
  }

  return sendJson(res, 501, {
    error: 'Endpoint is not implemented in nerve-studio preview server.',
    endpoint: `${req.method} ${url.pathname}`,
  })
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, mode: 'preview' })
  }

  if (url.pathname === '/htmx.js') {
    return sendText(res, 200, '// htmx is intentionally stubbed in preview mode', 'text/javascript; charset=utf-8')
  }

  if (url.pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, url)
    } catch (err) {
      return sendJson(res, 500, { error: String(err?.message ?? err ?? 'Internal server error') })
    }
  }

  const targetPath = url.pathname === '/' ? '/index.html' : url.pathname
  const fullPath = safePublicPath(targetPath)
  if (!fullPath || !existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    return sendText(res, 404, 'Not Found')
  }

  const content = readFileSync(fullPath)
  const mime = getMimeTypeForPath(fullPath)
  res.writeHead(200, { 'Content-Type': mime })
  res.end(content)
}

const server = createServer((req, res) => {
  handleRequest(req, res)
})

server.listen(PORT, () => {
  console.log(`nerve-studio preview running at http://localhost:${PORT}`)
})

process.on('exit', () => {
  stopManagedRuntimeProcess()
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopManagedRuntimeProcess()
    process.exit(0)
  })
}
