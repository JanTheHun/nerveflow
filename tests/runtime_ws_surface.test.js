import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { resolve } from 'node:path'
import { WebSocket } from 'ws'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../src/runtime/index.js'

const MESSAGE_TIMEOUT_MS = 5000
const REPO_ROOT = resolve(process.cwd())

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

function waitForWsOpen(ws, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolveOpen, rejectOpen) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectOpen(new Error('Timed out waiting for websocket open'))
    }, timeoutMs)

    ws.once('open', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveOpen()
    })

    ws.once('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectOpen(err)
    })
  })
}

function waitForWsMessage(ws, predicate, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return new Promise((resolveMessage, rejectMessage) => {
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      rejectMessage(new Error('Timed out waiting for websocket message'))
    }, timeoutMs)

    const cleanup = () => {
      ws.off('message', onMessage)
      ws.off('error', onError)
      ws.off('close', onClose)
      clearTimeout(timer)
    }

    const onError = (err) => {
      if (settled) return
      settled = true
      cleanup()
      rejectMessage(err)
    }

    const onClose = () => {
      if (settled) return
      settled = true
      cleanup()
      rejectMessage(new Error('WebSocket closed while waiting for message'))
    }

    const onMessage = (raw) => {
      let parsed
      try {
        parsed = JSON.parse(String(raw ?? ''))
      } catch {
        return
      }

      if (!predicate(parsed)) return

      if (settled) return
      settled = true
      cleanup()
      resolveMessage(parsed)
    }

    ws.on('message', onMessage)
    ws.once('error', onError)
    ws.once('close', onClose)
  })
}

function closeWs(ws) {
  return new Promise((resolveClose) => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolveClose()
    ws.once('close', () => resolveClose())
    ws.close()
  })
}

async function createRuntimeSurfaceHarness() {
  const runtimeCore = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  await runtimeCore.start({ workspaceDir: 'examples/mqtt-simple-host' })

  const httpServer = createServer((_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not Found')
  })

  const wsPath = '/api/runtime/ws'
  const wsSurface = createRuntimeWebSocketSurface({
    server: httpServer,
    runtimeCore,
    path: wsPath,
  })

  const port = await findOpenPort()
  await new Promise((resolveListen, rejectListen) => {
    httpServer.listen(port, '127.0.0.1', (err) => {
      if (err) return rejectListen(err)
      resolveListen()
    })
  })

  return {
    runtimeCore,
    wsSurface,
    httpServer,
    wsUrl: `ws://127.0.0.1:${port}${wsPath}`,
    async close() {
      try { wsSurface.close() } catch {}
      try { runtimeCore.shutdown() } catch {}
      await new Promise((resolveClose) => {
        httpServer.close(() => resolveClose())
      })
    },
  }
}

test('runtime ws surface handshake and snapshot command', async () => {
  const harness = await createRuntimeSurfaceHarness()
  const ws = new WebSocket(harness.wsUrl)

  try {
    const handshakePromise = waitForWsMessage(
      ws,
      (message) => message?.type === 'response' && !message?.requestId,
    )
    await waitForWsOpen(ws)

    const handshake = await handshakePromise
    assert.equal(handshake.ok, true)
    assert.equal(Array.isArray(handshake?.capabilities?.surfaces), true)
    assert.equal(handshake.capabilities.surfaces.includes('websocket'), true)

    ws.send(JSON.stringify({ type: 'snapshot', requestId: 'snapshot-1' }))
    const snapshotResponse = await waitForWsMessage(
      ws,
      (message) => message?.type === 'response' && message?.requestId === 'snapshot-1',
    )

    assert.equal(snapshotResponse.ok, true)
    assert.equal(snapshotResponse.data.running, true)
    assert.equal(typeof snapshotResponse.data.snapshot, 'object')
  } finally {
    await closeWs(ws)
    await harness.close()
  }
})

test('runtime continues after one ws surface detaches', async () => {
  const harness = await createRuntimeSurfaceHarness()
  const ws1 = new WebSocket(harness.wsUrl)
  const ws2 = new WebSocket(harness.wsUrl)

  try {
    const ws1HandshakePromise = waitForWsMessage(
      ws1,
      (message) => message?.type === 'response' && !message?.requestId,
    )
    const ws2HandshakePromise = waitForWsMessage(
      ws2,
      (message) => message?.type === 'response' && !message?.requestId,
    )

    await waitForWsOpen(ws1)
    await waitForWsOpen(ws2)

    await ws1HandshakePromise
    await ws2HandshakePromise

    await closeWs(ws1)

    assert.equal(harness.runtimeCore.isActive(), true)

    const enqueueResponsePromise = waitForWsMessage(
      ws2,
      (message) => message?.type === 'response' && message?.requestId === 'enq-1',
    )
    const queuedEventPromise = waitForWsMessage(
      ws2,
      (message) => message?.type === 'event' && message?.eventName === 'nextv_event_queued',
    )

    ws2.send(JSON.stringify({
      type: 'enqueue_event',
      requestId: 'enq-1',
      payload: { eventType: 'sensor_reading', value: '99' },
    }))

    const enqueueResponse = await enqueueResponsePromise
    assert.equal(enqueueResponse.ok, true)

    const queuedEvent = await queuedEventPromise
    assert.equal(queuedEvent.eventName, 'nextv_event_queued')
  } finally {
    await closeWs(ws2)
    await harness.close()
  }
})
