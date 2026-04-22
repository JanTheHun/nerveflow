import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer } from 'ws'

import {
  NextVEventRunner,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  runNextVScriptFromFile,
  validateOutputContract,
} from '../../src/index.js'

import {
  areJsonStatesEqual,
  clearTimerHandles,
  createEventBus,
  createHostAdapter,
  createNextVRuntimeController,
  getDeclaredExternals,
  hasMeaningfulNextVExecutionEvents,
  loadWorkspaceNextVConfig,
  normalizeInputEvent,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  startTimerHandles,
} from '../../src/host_core/index.js'

import {
  buildHostProtocolEvent,
  buildHostProtocolResponse,
  validateHostProtocolCommand,
} from '../../src/host_core/protocol.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(join(__dirname, '..', '..'))
const PUBLIC_DIR = join(__dirname, 'public')

const PORT = Number(process.env.PORT ?? 4185)
const WS_PATH = '/api/nextv/ws'

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.nrv': 'text/plain; charset=utf-8',
  '.wfs': 'text/plain; charset=utf-8',
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function toWorkspaceDisplayPath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath)
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

function getMimeTypeForPath(filePath) {
  const ext = extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] || 'application/octet-stream'
}

function resolveWorkspaceDirectory(inputPath) {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) {
    const rel = relative(REPO_ROOT, __dirname).replace(/\\/g, '/')
    return {
      absolutePath: __dirname,
      relativePath: rel || '.',
    }
  }

  if (isAbsolute(candidate)) {
    throw new Error('Only workspace-relative paths are allowed')
  }

  const absolutePath = resolve(REPO_ROOT, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }

  return {
    absolutePath,
    relativePath: rel.replace(/\\/g, '/'),
  }
}

function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) throw new Error('filePath required')
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

  const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Path is outside workspace')
  }

  const ext = extname(absolutePath).toLowerCase()
  if (kindRaw === 'script' && ext && ext !== '.nrv' && ext !== '.wfs') {
    throw new Error(`Unsupported extension '${ext}' for script`)
  }

  return {
    absolutePath,
    relativePath: rel.replace(/\\/g, '/'),
  }
}

function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
  const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
  const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
  if (!rawEntrypoint) {
    throw new Error('entrypointPath required (or set nextv.json entrypointPath)')
  }

  const joined = join(workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath, rawEntrypoint)
  const entrypoint = resolvePathFromBaseDirectory(REPO_ROOT, joined.replace(/\\/g, '/'), 'script')
  if (!existsSync(entrypoint.absolutePath)) {
    throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
  }

  return entrypoint
}

function mapRuntimeErrorCode(errorLike) {
  const message = String(errorLike?.message ?? errorLike ?? '').toLowerCase()
  if (message.includes('not active') || message.includes('not running')) return 'not_active'
  if (message.includes('already active')) return 'already_active'
  if (message.includes('not allowed') || message.includes('policy')) return 'policy_denied'
  if (message.includes('not available')) return 'unavailable'
  if (message.includes('invalid') || message.includes('required')) return 'validation_error'
  return 'runtime_error'
}

function sendWsResponse(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  ws.send(JSON.stringify({ type: 'response', ...payload }))
}

function sendWsEvent(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  ws.send(JSON.stringify({ type: 'event', ...payload }))
}

const eventBus = createEventBus()

const runtimeController = createNextVRuntimeController({
  eventBus,
  createRunner: (options) => new NextVEventRunner(options),
  createHostAdapter,
  resolveWorkspaceDirectory,
  loadWorkspaceConfig: (workspaceDir) => loadWorkspaceNextVConfig({
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
  getDeclaredExternals,
  areJsonStatesEqual,
  hasMeaningfulNextVExecutionEvents,
  normalizeInputEvent,
  startTimerHandles,
  clearTimerHandles,
  runNextVScriptFromFile,
  validateOutputContract,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  callAgent: async ({ model, messages }) => {
    const prompt = messages?.[messages.length - 1]?.content ?? ''
    return JSON.stringify({ status: 'ready', action: 'mock_agent', model: model || '', prompt })
  },
  defaultModel: '',
})

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, mode: 'ws-simple-host' })
  }

  const targetPath = url.pathname === '/' ? '/index.html' : url.pathname
  const fullPath = resolve(PUBLIC_DIR, `.${targetPath}`)

  if (!fullPath.startsWith(PUBLIC_DIR) || !existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
    return
  }

  res.writeHead(200, { 'Content-Type': getMimeTypeForPath(fullPath) })
  res.end(readFileSync(fullPath))
})

const wss = new WebSocketServer({ server, path: WS_PATH })
let eventSequence = 0

wss.on('connection', (ws) => {
  const session = {
    sessionId: `ws-${randomUUID()}`,
    subscribed: true,
  }

  const eventHandler = (eventName, payload) => {
    if (!session.subscribed) return

    try {
      const envelope = buildHostProtocolEvent({
        eventName,
        payload,
        sessionId: session.sessionId,
        sequence: eventSequence++,
        timestamp: new Date().toISOString(),
      })
      sendWsEvent(ws, envelope)
    } catch {
      // Keep stream alive when one event cannot be projected.
    }
  }

  eventBus.subscribe(eventHandler)

  sendWsResponse(ws, buildHostProtocolResponse({
    sessionId: session.sessionId,
    ok: true,
    data: {
      connected: true,
      active: runtimeController.isActive(),
      snapshot: runtimeController.getActiveSnapshot(),
    },
    capabilities: {
      surfaces: ['http', 'websocket'],
    },
    timestamp: new Date().toISOString(),
  }))

  ws.on('message', async (raw) => {
    let parsedRaw
    try {
      parsedRaw = JSON.parse(String(raw ?? '{}'))
    } catch {
      sendWsResponse(ws, buildHostProtocolResponse({
        sessionId: session.sessionId,
        ok: false,
        error: {
          code: 'validation_error',
          message: 'WebSocket command must be valid JSON.',
        },
        timestamp: new Date().toISOString(),
      }))
      return
    }

    let command
    try {
      command = validateHostProtocolCommand(parsedRaw)
    } catch (err) {
      sendWsResponse(ws, buildHostProtocolResponse({
        requestId: parsedRaw?.requestId,
        sessionId: session.sessionId,
        ok: false,
        error: {
          code: 'validation_error',
          message: String(err?.message ?? err),
        },
        timestamp: new Date().toISOString(),
      }))
      return
    }

    try {
      const payload = command.payload ?? {}
      let data

      if (command.type === 'start') {
        data = await runtimeController.start(payload)
      } else if (command.type === 'stop') {
        if (!runtimeController.isActive()) {
          throw new Error('nextV runtime not active')
        }
        data = { snapshot: runtimeController.stop() }
      } else if (command.type === 'enqueue_event') {
        data = runtimeController.enqueue(payload)
      } else if (command.type === 'snapshot') {
        const snapshot = runtimeController.getSnapshot()
        data = {
          running: snapshot?.running === true,
          snapshot,
        }
      } else if (command.type === 'subscribe') {
        session.subscribed = true
        data = { subscribed: true, active: runtimeController.isActive() }
      } else if (command.type === 'unsubscribe') {
        session.subscribed = false
        data = { subscribed: false }
      } else {
        throw new Error(`Unsupported command type: ${command.type}`)
      }

      sendWsResponse(ws, buildHostProtocolResponse({
        requestId: command.requestId,
        sessionId: session.sessionId,
        ok: true,
        data,
        timestamp: new Date().toISOString(),
      }))
    } catch (err) {
      sendWsResponse(ws, buildHostProtocolResponse({
        requestId: command.requestId,
        sessionId: session.sessionId,
        ok: false,
        error: {
          code: mapRuntimeErrorCode(err),
          message: String(err?.message ?? err),
        },
        timestamp: new Date().toISOString(),
      }))
    }
  })

  ws.on('close', () => {
    eventBus.unsubscribe(eventHandler)
  })

  ws.on('error', () => {
    eventBus.unsubscribe(eventHandler)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`ws-simple-host listening at http://127.0.0.1:${PORT}`)
  console.log(`ws-simple-host websocket at ws://127.0.0.1:${PORT}${WS_PATH}`)
})
