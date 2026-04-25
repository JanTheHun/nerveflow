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

function runProcess(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('exit', (code, signal) => {
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

function parseJsonObjects(text) {
  const source = String(text ?? '')
  const results = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = source.slice(start, index + 1)
        try {
          results.push(JSON.parse(candidate))
        } catch {
          // ignore malformed segments and keep scanning
        }
        start = -1
      }
    }
  }

  return results
}

function parseAttachResponseOrThrow(text, context) {
  const objects = parseJsonObjects(text)
  const response = objects.find((obj) => obj?.type === 'response' && typeof obj?.ok === 'boolean')
    ?? objects.find((obj) => typeof obj?.ok === 'boolean')

  if (response) return response
  throw new Error(`${context} did not return a response envelope\nOutput:\n${text}`)
}

test('nerve-runtime exits with usage error when arguments are missing', async () => {
  const result = await runProcess(['bin/nerve-runtime.js'])
  assert.equal(result.code, 1)
  assert.equal(result.stderr.includes('nerve-runtime argument error'), true)
})

test('nerve-attach exits with usage error when arguments are missing', async () => {
  const result = await runProcess(['bin/nerve-attach.js'])
  assert.equal(result.code, 1)
  assert.equal(result.stderr.includes('nerve-attach argument error'), true)
})

test('nerve-runtime starts and serves health endpoint', async () => {
  const port = await findOpenPort()
  const child = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(port),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForOutput(child, 'nerve-runtime listening at')

    const response = await fetch(`http://127.0.0.1:${port}/health`)
    const payload = await response.json()

    assert.equal(response.ok, true)
    assert.equal(payload.ok, true)
    assert.equal(payload.mode, 'runtime')
    assert.equal(typeof payload.status, 'object')
    assert.equal(typeof payload.status.active, 'boolean')
  } finally {
    await new Promise((resolveExit) => {
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
})

test('nerve-attach can snapshot enqueue and stop a live runtime', async () => {
  const port = await findOpenPort()
  const child = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(port),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForOutput(child, 'nerve-runtime listening at')

    const wsUrl = `ws://127.0.0.1:${port}/api/runtime/ws`

    const snapshotResult = await runProcess(['bin/nerve-attach.js', wsUrl, 'snapshot'])
    assert.equal(snapshotResult.code, 0)
    const snapshotPayload = parseAttachResponseOrThrow(snapshotResult.stdout, 'snapshot')
    assert.equal(snapshotPayload.ok, true)
    assert.equal(snapshotPayload.data.running, true)

    const enqueueResult = await runProcess([
      'bin/nerve-attach.js',
      wsUrl,
      'enqueue',
      'user_message',
      'hello',
    ])
    assert.equal(enqueueResult.code, 0)
    const enqueuePayload = parseAttachResponseOrThrow(enqueueResult.stdout, 'enqueue')
    assert.equal(enqueuePayload.ok, true)
    assert.equal(typeof enqueuePayload.data?.event, 'object')

    const stopResult = await runProcess(['bin/nerve-attach.js', wsUrl, 'stop'])
    assert.equal(stopResult.code, 0)
    const stopPayload = parseAttachResponseOrThrow(stopResult.stdout, 'stop')
    assert.equal(stopPayload.ok, true)
    assert.equal(stopPayload.data.snapshot.running, false)
  } finally {
    await new Promise((resolveExit) => {
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
})
