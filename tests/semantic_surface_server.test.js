import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'

const SERVER_BOOT_TIMEOUT_MS = 15000
const MESSAGE_TIMEOUT_MS = 5000

let serverProcess = null
let serverPort = 0
let tempDir = ''
let stateFilePath = ''

function findOpenPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
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

function waitForServerReady(child, timeoutMs = SERVER_BOOT_TIMEOUT_MS) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false
    let output = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectReady(new Error(`Timed out waiting for semantic-surface server to start. Output:\n${output}`))
    }, timeoutMs)

    const onData = (chunk) => {
      output += String(chunk)
      if (output.includes('semantic-surface scaffold listening')) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveReady()
      }
    }

    const onExit = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectReady(new Error(`semantic-surface server exited before ready (code=${code}, signal=${signal}). Output:\n${output}`))
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
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

before(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'semantic-surface-server-'))
  stateFilePath = path.join(tempDir, 'semantic-surface-state.json')

  await writeFile(stateFilePath, JSON.stringify({
    interactions: [
      {
        interactionId: 'confirm_delete_1',
        target: 'main',
        value: {
          intent: {
            type: 'choice',
            text: 'Delete reminders?',
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        },
        renderedAt: '2026-05-29T12:00:00Z',
      },
    ],
    updatedAt: '2026-05-29T12:00:00Z',
  }, null, 2), 'utf8')

  serverPort = await findOpenPort()
  serverProcess = spawn(process.execPath, ['examples/semantic-surface/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEMANTIC_SURFACE_PORT: String(serverPort),
      SEMANTIC_SURFACE_STATE_PATH: stateFilePath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  await waitForServerReady(serverProcess)
})

after(async () => {
  if (serverProcess && !serverProcess.killed) {
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => {
        try {
          serverProcess.kill('SIGKILL')
        } catch {
          // ignore force-kill errors
        }
        resolveExit()
      }, 3000)

      serverProcess.once('exit', () => {
        clearTimeout(timer)
        resolveExit()
      })

      try {
        serverProcess.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolveExit()
      }
    })
  }

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('semantic-surface websocket pushes snapshots and accepts choice ingress', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/semantic-surface/ws`)

  try {
    await waitForWsOpen(ws)

    const initialSnapshot = await waitForWsMessage(
      ws,
      (message) => message?.type === 'snapshot' && Array.isArray(message?.snapshot?.interactions),
    )

    assert.equal(initialSnapshot.snapshot.interactions.length, 1)
    assert.equal(initialSnapshot.snapshot.interactions[0].interactionId, 'confirm_delete_1')

    ws.send(JSON.stringify({
      type: 'semantic_surface_event',
      payload: {
        interactionId: 'confirm_delete_1',
        target: 'main',
        action: 'selected',
        payload: { selected: 'yes' },
      },
    }))

    const updatedSnapshot = await waitForWsMessage(
      ws,
      (message) => message?.type === 'snapshot' && Array.isArray(message?.snapshot?.interactions) && message.snapshot.interactions.length === 0,
    )

    assert.equal(updatedSnapshot.snapshot.interactions.length, 0)

    const diskState = JSON.parse(await readFile(stateFilePath, 'utf8'))
    assert.equal(diskState.interactions.length, 0)
    assert.equal(diskState.updatedAt.length > 0, true)
  } finally {
    await closeWs(ws)
  }
})

test('semantic-surface relays choice ingress through runtime websocket when configured', async () => {
  const runtimeStateFilePath = path.join(tempDir, 'runtime-state.json')
  await writeFile(runtimeStateFilePath, JSON.stringify({
    interactions: [
      {
        interactionId: 'confirm_delete_1',
        target: 'main',
        value: {
          intent: {
            type: 'choice',
            text: 'Delete reminders?',
            options: [
              { id: 'yes', label: 'Yes' },
              { id: 'no', label: 'No' },
            ],
          },
        },
        renderedAt: '2026-05-29T12:00:00Z',
      },
    ],
    updatedAt: '2026-05-29T12:00:00Z',
  }, null, 2), 'utf8')

  const runtimeServer = new WebSocketServer({ port: 0 })
  const runtimePort = typeof runtimeServer.address() === 'object' && runtimeServer.address()
    ? runtimeServer.address().port
    : 0
  const dispatchedPayloads = []

  runtimeServer.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let message
      try {
        message = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      if (message?.type !== 'dispatch_ingress' || !message?.requestId) return
      dispatchedPayloads.push(message.payload)

      const payload = message?.payload ?? {}
      const selected = payload?.value?.selected
        ?? payload?.payload?.selected
        ?? payload?.value?.payload?.selected
      if (selected === 'yes') {
        const current = JSON.parse(await readFile(runtimeStateFilePath, 'utf8'))
        current.interactions = []
        current.updatedAt = '2026-05-29T12:01:00Z'
        await writeFile(runtimeStateFilePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
      }

      ws.send(JSON.stringify({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        data: { dispatchedCount: 1 },
      }))
    })
  })

  const relayServerPort = await findOpenPort()
  const relayServerProcess = spawn(process.execPath, ['examples/semantic-surface/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SEMANTIC_SURFACE_PORT: String(relayServerPort),
      SEMANTIC_SURFACE_STATE_PATH: runtimeStateFilePath,
      RUNTIME_WS_URL: `ws://127.0.0.1:${runtimePort}/api/runtime/ws`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForServerReady(relayServerProcess)

    const ws = new WebSocket(`ws://127.0.0.1:${relayServerPort}/api/semantic-surface/ws`)
    try {
      await waitForWsOpen(ws)
      await waitForWsMessage(
        ws,
        (message) => message?.type === 'snapshot' && Array.isArray(message?.snapshot?.interactions),
      )

      ws.send(JSON.stringify({
        type: 'semantic_surface_event',
        payload: {
          interactionId: 'confirm_delete_1',
          target: 'main',
          action: 'selected',
          payload: { selected: 'yes' },
        },
      }))

      const updatedSnapshot = await waitForWsMessage(
        ws,
        (message) => message?.type === 'snapshot' && Array.isArray(message?.snapshot?.interactions) && message.snapshot.interactions.length === 0,
      )

      assert.equal(updatedSnapshot.snapshot.interactions.length, 0)
      assert.equal(dispatchedPayloads.length, 1)
      assert.equal(dispatchedPayloads[0].name, 'semantic_surface_event')
      assert.equal(dispatchedPayloads[0].eventType, 'semantic_surface_event')
      assert.equal(dispatchedPayloads[0].interactionId, 'confirm_delete_1')
      assert.equal(dispatchedPayloads[0].target, 'main')
      assert.equal(dispatchedPayloads[0].action, 'selected')
      assert.equal(dispatchedPayloads[0].value.selected, 'yes')
    } finally {
      await closeWs(ws)
    }
  } finally {
    if (runtimeServer) {
      await new Promise((resolveClose) => runtimeServer.close(resolveClose))
    }
    if (relayServerProcess && !relayServerProcess.killed) {
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => {
          try {
            relayServerProcess.kill('SIGKILL')
          } catch {
            // ignore force-kill errors
          }
          resolveExit()
        }, 3000)

        relayServerProcess.once('exit', () => {
          clearTimeout(timer)
          resolveExit()
        })

        try {
          relayServerProcess.kill('SIGTERM')
        } catch {
          clearTimeout(timer)
          resolveExit()
        }
      })
    }
  }
})