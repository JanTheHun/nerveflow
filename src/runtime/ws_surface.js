import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

import {
  buildHostProtocolEvent,
} from '../host_core/protocol.js'

import {
  createRuntimeCommandRouter,
} from './command_router.js'

function sendWsResponse(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  ws.send(JSON.stringify({ type: 'response', ...payload }))
}

function sendWsEvent(ws, payload) {
  if (!ws || ws.readyState !== 1) return
  ws.send(JSON.stringify({ type: 'event', ...payload }))
}

export function createRuntimeWebSocketSurface({
  server,
  runtimeCore,
  path = '/api/runtime/ws',
  createSessionId,
} = {}) {
  if (!server) throw new Error('createRuntimeWebSocketSurface requires server')
  if (!runtimeCore) throw new Error('createRuntimeWebSocketSurface requires runtimeCore')

  const wss = new WebSocketServer({ server, path })
  let sequence = 0

  wss.on('connection', (ws) => {
    const sessionId = typeof createSessionId === 'function'
      ? createSessionId()
      : `runtime-ws-${randomUUID()}`

    const session = {
      subscribed: true,
    }

    const commandRouter = createRuntimeCommandRouter({
      runtimeCore,
      sessionId,
      onSubscribe: () => {
        session.subscribed = true
      },
      onUnsubscribe: () => {
        session.subscribed = false
      },
    })

    const detach = runtimeCore.attachSurface((eventName, payload) => {
      if (!session.subscribed) return
      try {
        const envelope = buildHostProtocolEvent({
          eventName,
          payload,
          sessionId,
          sequence: sequence++,
          timestamp: new Date().toISOString(),
        })
        sendWsEvent(ws, envelope)
      } catch {
        // Keep connection alive when one event envelope cannot be projected
      }
    })

    sendWsResponse(ws, {
      protocolVersion: '1.0',
      sessionId,
      ok: true,
      data: {
        connected: true,
        active: runtimeCore.isActive(),
        snapshot: runtimeCore.getSnapshot(),
      },
      capabilities: {
        surfaces: ['websocket'],
      },
      timestamp: new Date().toISOString(),
    })

    ws.on('message', async (raw) => {
      const response = await commandRouter.handleRawCommand(raw)
      sendWsResponse(ws, response)
    })

    ws.on('close', () => {
      detach()
    })
  })

  return {
    wss,
    close() {
      wss.close()
    },
  }
}
