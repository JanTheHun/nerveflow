import http from 'node:http'
import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync, readFileSync, watch } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'
import {
  createSemanticSurfaceEffectRealizer,
  createSemanticSurfaceIngressConnector,
  getSemanticSurfaceSnapshot,
} from './server_lib.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(dirname, 'public')
const envPath = path.join(dirname, '.env')

loadDotEnvFile(envPath)

const port = Number(process.env.SEMANTIC_SURFACE_PORT ?? 4180)
const stateFilePath = path.resolve(process.env.SEMANTIC_SURFACE_STATE_PATH ?? path.join(dirname, 'semantic-surface-state.json'))
const runtimeWsUrl = String(process.env.RUNTIME_WS_URL ?? '').trim()
const ingressName = String(process.env.SEMANTIC_SURFACE_INGRESS_NAME ?? 'semantic_surface_event').trim() || 'semantic_surface_event'
const websocketPath = '/api/semantic-surface/ws'

// Initialize local adapters so this scaffold is self-checking.
const ingress = createSemanticSurfaceIngressConnector({ ingressName, stateFilePath })
const realize = createSemanticSurfaceEffectRealizer({ stateFilePath })
void ingress
void realize

await mkdir(path.dirname(stateFilePath), { recursive: true })

const clients = new Set()
const websocketServer = new WebSocketServer({ noServer: true })

function parseDotEnv(rawContent) {
  const output = {}
  for (const lineRaw of String(rawContent ?? '').split(/\r?\n/)) {
    const line = lineRaw.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    if (!key) continue
    let value = line.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    output[key] = value
  }
  return output
}

function loadDotEnvFile(filePath) {
  if (!existsSync(filePath)) return

  try {
    const parsed = parseDotEnv(readFileSync(filePath, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null) {
        process.env[key] = value
      }
    }
  } catch {
    // Keep startup non-fatal if the optional .env file cannot be read.
  }
}

function asTrimmedString(value) {
  return String(value ?? '').trim()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSemanticIngressPayload(rawPayload = {}) {
  const interactionId = asTrimmedString(rawPayload.interactionId)
  const target = asTrimmedString(rawPayload.target)
  const action = asTrimmedString(rawPayload.action)
  const schemaVersion = asTrimmedString(rawPayload.schemaVersion) || '1.0'
  const eventType = asTrimmedString(rawPayload.eventType) || ingressName
  const sourceSessionId = asTrimmedString(rawPayload.sourceSessionId) || 'semantic-surface-browser'
  const timestamp = asTrimmedString(rawPayload.timestamp) || new Date().toISOString()

  const payloadObject = isPlainObject(rawPayload.payload)
    ? rawPayload.payload
    : (isPlainObject(rawPayload.value) ? rawPayload.value : null)
  const valueObject = isPlainObject(rawPayload.value)
    ? rawPayload.value
    : payloadObject

  return {
    interactionId,
    target,
    action,
    payload: payloadObject,
    value: valueObject,
    eventType,
    schemaVersion,
    sourceSessionId,
    timestamp,
  }
}

function sendSnapshot(ws, snapshot) {
  if (!ws || ws.readyState !== 1) return
  ws.send(JSON.stringify({
    type: 'snapshot',
    snapshot,
  }))
}

async function broadcastSnapshot() {
  const snapshot = await getSemanticSurfaceSnapshot({ stateFilePath })
  for (const client of clients) {
    sendSnapshot(client, snapshot)
  }
}

function openRuntimeSocket() {
  if (!runtimeWsUrl) return null
  return new Promise((resolveSocket, rejectSocket) => {
    const runtimeSocket = new WebSocket(runtimeWsUrl)
    const onOpen = () => {
      runtimeSocket.off('error', onError)
      resolveSocket(runtimeSocket)
    }
    const onError = (error) => {
      runtimeSocket.off('open', onOpen)
      rejectSocket(error)
    }

    runtimeSocket.once('open', onOpen)
    runtimeSocket.once('error', onError)
  })
}

async function dispatchIngressViaRuntime(payload) {
  if (!runtimeWsUrl) {
    throw new Error('runtime ws url is not configured')
  }

  const runtimeSocket = await openRuntimeSocket()
  const requestId = `semantic-surface-${Date.now().toString(36)}`

  return await new Promise((resolveDispatch, rejectDispatch) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectDispatch(new Error('semantic-surface dispatch timed out'))
    }, 10000)

    const cleanup = () => {
      clearTimeout(timeout)
      runtimeSocket.removeAllListeners('message')
      runtimeSocket.removeAllListeners('close')
      runtimeSocket.removeAllListeners('error')
      try {
        runtimeSocket.close()
      } catch {
        // ignore
      }
    }

    runtimeSocket.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      if (message?.type !== 'response' || message?.requestId !== requestId) return
      if (message.ok !== true) {
        const errorMessage = String(message?.error?.message ?? 'semantic-surface dispatch failed')
        cleanup()
        rejectDispatch(new Error(errorMessage))
        return
      }

      cleanup()
      resolveDispatch(message.data ?? {})
    })

    runtimeSocket.on('close', () => {
      cleanup()
      rejectDispatch(new Error('runtime websocket closed before semantic-surface dispatch completed'))
    })

    runtimeSocket.on('error', (error) => {
      cleanup()
      rejectDispatch(error)
    })

    runtimeSocket.send(JSON.stringify({
      type: 'dispatch_ingress',
      requestId,
      payload,
    }))
  })
}

function parseSocketMessage(raw) {
  try {
    return JSON.parse(String(raw ?? '{}'))
  } catch {
    return null
  }
}

websocketServer.on('connection', async (ws) => {
  clients.add(ws)

  try {
    sendSnapshot(ws, await getSemanticSurfaceSnapshot({ stateFilePath }))
  } catch {
    // Keep the connection alive even if one snapshot read fails.
  }

  ws.on('message', async (raw) => {
    const message = parseSocketMessage(raw)
    if (!message || message.type !== 'semantic_surface_event') return

    try {
      const semanticPayload = normalizeSemanticIngressPayload(message.payload ?? {})
      if (runtimeWsUrl) {
        await dispatchIngressViaRuntime({
          name: ingressName,
          ...semanticPayload,
        })
      } else {
        const ingressHandler = ingress[ingressName]
        if (typeof ingressHandler !== 'function') {
          throw new Error(`semantic-surface ingress handler not found: ${ingressName}`)
        }
        await ingressHandler(semanticPayload)
      }
      await broadcastSnapshot()
    } catch (error) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'error',
          message: String(error?.message ?? error),
        }))
      }
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
  })
})

function contentTypeFor(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8'
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  return 'text/plain; charset=utf-8'
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')

  if (url.pathname === '/api/interactions') {
    const snapshot = await getSemanticSurfaceSnapshot()
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(snapshot))
    return
  }

  if (url.pathname === '/favicon.ico') {
    res.writeHead(204)
    res.end()
    return
  }

  const safePath = url.pathname === '/' ? '/index.html' : url.pathname
  const resolvedPath = path.join(publicDir, safePath)

  try {
    const body = await readFile(resolvedPath)
    res.writeHead(200, { 'content-type': contentTypeFor(resolvedPath) })
    res.end(body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
})

const stateWatcher = watch(path.dirname(stateFilePath), { persistent: false }, async (_eventType, filename) => {
  if (filename && filename !== path.basename(stateFilePath)) return
  try {
    await broadcastSnapshot()
  } catch {
    // best effort
  }
})

void stateWatcher

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname !== websocketPath) {
    socket.destroy()
    return
  }

  websocketServer.handleUpgrade(req, socket, head, (ws) => {
    websocketServer.emit('connection', ws, req)
  })
})

server.on('close', () => {
  try {
    stateWatcher.close()
  } catch {
    // ignore
  }

  for (const client of clients) {
    try {
      client.close()
    } catch {
      // ignore
    }
  }
})

server.listen(port, () => {
  console.log(`semantic-surface scaffold listening on http://localhost:${port}`)
})
