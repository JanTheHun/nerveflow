import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

import { createEventBus } from '../src/host_core/event_bus.js'
import { createWsRemoteBridge } from '../nerve-studio/ws-remote-bridge.js'

function findOpenPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = Number(address?.port ?? 0)
      server.close((err) => {
        if (err) return rejectPort(err)
        resolvePort(port)
      })
    })
    server.on('error', rejectPort)
  })
}

function waitUntil(predicate, timeoutMs = 5000, intervalMs = 25) {
  return new Promise((resolveWait, rejectWait) => {
    const started = Date.now()

    const tick = () => {
      if (predicate()) return resolveWait()
      if (Date.now() - started > timeoutMs) {
        return rejectWait(new Error('Timed out waiting for condition'))
      }
      setTimeout(tick, intervalMs)
    }

    tick()
  })
}

async function createRemoteBridgeHarness() {
  const port = await findOpenPort()
  const server = createHttpServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  })

  const path = '/api/runtime/ws'
  const wss = new WebSocketServer({ server, path })
  const observedCommands = []

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({
      type: 'response',
      protocolVersion: '1.0',
      sessionId: `runtime-ws-${randomUUID()}`,
      ok: true,
      data: {
        connected: true,
        active: true,
        snapshot: {
          running: true,
          executionCount: 0,
        },
      },
      timestamp: new Date().toISOString(),
    }))

    socket.on('message', (raw) => {
      let parsed
      try {
        parsed = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      observedCommands.push(parsed)

      if (parsed?.type === 'snapshot') {
        socket.send(JSON.stringify({
          type: 'response',
          protocolVersion: '1.0',
          requestId: parsed.requestId,
          sessionId: 'runtime-ws-test',
          ok: true,
          data: {
            running: true,
            snapshot: {
              running: true,
              queueLength: 0,
            },
          },
          timestamp: new Date().toISOString(),
        }))
        return
      }

      if (parsed?.type === 'enqueue_event') {
        socket.send(JSON.stringify({
          type: 'event',
          protocolVersion: '1.0',
          eventName: 'nextv_event_queued',
          payload: {
            event: {
              type: parsed?.payload?.eventType ?? '',
              value: parsed?.payload?.value ?? '',
            },
            snapshot: {
              running: true,
              queueLength: 0,
            },
          },
          timestamp: new Date().toISOString(),
        }))

        socket.send(JSON.stringify({
          type: 'response',
          protocolVersion: '1.0',
          requestId: parsed.requestId,
          sessionId: 'runtime-ws-test',
          ok: true,
          data: {
            event: {
              type: parsed?.payload?.eventType ?? '',
              value: parsed?.payload?.value ?? '',
            },
            snapshot: {
              running: true,
              queueLength: 0,
            },
          },
          timestamp: new Date().toISOString(),
        }))
      }
    })
  })

  await new Promise((resolveListen, rejectListen) => {
    server.listen(port, '127.0.0.1', (err) => {
      if (err) return rejectListen(err)
      resolveListen()
    })
  })

  return {
    wsUrl: `ws://127.0.0.1:${port}${path}`,
    observedCommands,
    async close() {
      await new Promise((resolveClose) => wss.close(() => resolveClose()))
      await new Promise((resolveClose) => server.close(() => resolveClose()))
    },
  }
}

test('ws remote bridge forwards events and supports command round-trip', async () => {
  const harness = await createRemoteBridgeHarness()
  const eventBus = createEventBus()
  const forwardedEvents = []

  const onEvent = (eventName, payload) => {
    forwardedEvents.push({ eventName, payload })
  }
  eventBus.subscribe(onEvent)

  const bridge = createWsRemoteBridge({
    wsUrl: harness.wsUrl,
    eventBus,
  })

  try {
    await waitUntil(() => bridge.getStatus().connected === true)

    const snapshot = await bridge.requestSnapshot()
    assert.equal(snapshot.running, true)
    assert.equal(typeof snapshot.snapshot, 'object')

    const enqueueResponse = await bridge.sendCommand({
      type: 'enqueue_event',
      payload: {
        eventType: 'user_message',
        value: 'hello',
      },
    })

    assert.equal(enqueueResponse.ok, true)
    assert.equal(enqueueResponse?.data?.event?.type, 'user_message')

    await waitUntil(() => forwardedEvents.some((event) => event.eventName === 'nextv_event_queued'))
    assert.equal(
      harness.observedCommands.some((command) => command?.type === 'snapshot'),
      true,
    )
    assert.equal(
      harness.observedCommands.some((command) => command?.type === 'enqueue_event'),
      true,
    )
  } finally {
    eventBus.unsubscribe(onEvent)
    bridge.disconnect()
    await harness.close()
  }
})
