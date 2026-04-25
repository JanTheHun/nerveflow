import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'

const SERVER_BOOT_TIMEOUT_MS = 20000

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

function waitForOutput(child, text, timeoutMs = SERVER_BOOT_TIMEOUT_MS) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false
    let output = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectReady(new Error(`Timed out waiting for output '${text}'. Output:\n${output}`))
    }, timeoutMs)

    const onData = (chunk) => {
      output += String(chunk)
      if (output.includes(text)) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveReady(output)
      }
    }

    const onExit = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectReady(new Error(`Process exited before expected output (code=${code}, signal=${signal}). Output:\n${output}`))
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })
}

function stopProcess(child) {
  return new Promise((resolveExit) => {
    if (!child || child.killed) return resolveExit()

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      resolveExit()
    }, 5000)

    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolveExit()
    }
  })
}

async function waitForSnapshot(url, predicate, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      const payload = await response.json().catch(() => ({}))
      if (predicate(response, payload)) {
        return { response, payload }
      }
    } catch {
      // retry while service is booting/connecting
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('Timed out waiting for snapshot condition')
}

test('preview server proxies control commands over remote ws runtime', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
      '--remote-ws',
      `ws://127.0.0.1:${runtimePort}/api/runtime/ws`,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const snapshotUrl = `http://127.0.0.1:${studioPort}/api/nextv/snapshot`

    const initial = await waitForSnapshot(
      snapshotUrl,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws' && payload?.running === true,
    )

    assert.equal(initial.payload.remoteMode, true)
    assert.equal(initial.payload.remoteControl, true)
    assert.equal(initial.payload.remoteTransport, 'ws')

    const enqueueResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'sensor_reading', value: '55', source: 'external' }),
    })
    const enqueuePayload = await enqueueResponse.json().catch(() => ({}))

    assert.equal(enqueueResponse.ok, true)
    assert.equal(enqueuePayload.ok, true)
    assert.equal(typeof enqueuePayload.snapshot, 'object')

    const stopResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const stopPayload = await stopResponse.json().catch(() => ({}))

    assert.equal(stopResponse.ok, true)
    assert.equal(stopPayload.ok, true)
    assert.equal(stopPayload?.snapshot?.running, false)

    const finalSnapshot = await waitForSnapshot(
      snapshotUrl,
      (response, payload) => response.ok && payload?.running === false,
    )
    assert.equal(finalSnapshot.payload.remoteControl, true)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
  }
})
