import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { WebSocket } from 'ws'

const SERVER_BOOT_TIMEOUT_MS = 15000
const MESSAGE_TIMEOUT_MS = 5000

let serverProcess = null
let serverPort = 0

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
      rejectReady(new Error(`Timed out waiting for ws-simple-host to start. Output:\n${output}`))
    }, timeoutMs)

    const onData = (chunk) => {
      output += String(chunk)
      if (output.includes('ws-simple-host listening at')) {
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
      rejectReady(new Error(`ws-simple-host exited before ready (code=${code}, signal=${signal}). Output:\n${output}`))
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
  serverPort = await findOpenPort()

  serverProcess = spawn(
    process.execPath,
    ['examples/ws-simple-host/server.js'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(serverPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  await waitForServerReady(serverProcess)
})

after(async () => {
  if (!serverProcess || serverProcess.killed) return

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
})

test('ws-simple-host websocket responds to handshake and snapshot command', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/api/nextv/ws`)

  try {
    await waitForWsOpen(ws)

    const handshake = await waitForWsMessage(
      ws,
      (message) => message?.type === 'response' && !message?.requestId,
    )
    assert.equal(handshake.ok, true)
    assert.equal(Array.isArray(handshake?.capabilities?.surfaces), true)
    assert.equal(handshake.capabilities.surfaces.includes('websocket'), true)

    ws.send(JSON.stringify({ type: 'snapshot', requestId: 'snapshot-1' }))
    const snapshotResponse = await waitForWsMessage(
      ws,
      (message) => message?.type === 'response' && message?.requestId === 'snapshot-1',
    )

    assert.equal(snapshotResponse.ok, true)
    assert.equal(typeof snapshotResponse?.data?.running, 'boolean')
    assert.equal(typeof snapshotResponse?.data?.snapshot, 'object')
  } finally {
    await closeWs(ws)
  }
})
