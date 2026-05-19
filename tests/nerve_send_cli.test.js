import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { WebSocketServer } from 'ws'

function runProcess(args, options = {}) {
  const cwd = options.cwd || process.cwd()
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd,
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

test('nerve-send requires wsUrl and eventType positionals', async () => {
  const result = await runProcess([
    path.join(process.cwd(), 'bin', 'nerve-send.js'),
    'ws://127.0.0.1:4190/api/runtime/ws',
  ])

  assert.equal(result.code, 1)
  assert.equal(result.stderr.includes('Usage: nerve-send <wsUrl> <eventType> [message]'), true)
})

test('nerve-send accepts positional wsUrl and eventType', async () => {
  const result = await runProcess([
    path.join(process.cwd(), 'bin', 'nerve-send.js'),
    'ws://127.0.0.1:4190/api/runtime/ws',
    'user_message',
    'ping',
  ])

  assert.equal(result.stderr.includes('nerve-send argument error'), false)
})

test('nerve-send surfaces nextv_error details without waiting for timeout', async () => {
  const wss = new WebSocketServer({ port: 0 })
  const address = wss.address()
  const port = typeof address === 'object' && address ? address.port : 0

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      const requestId = String(message?.requestId ?? '')
      if (!requestId) return

      if (message.type === 'subscribe') {
        ws.send(JSON.stringify({
          type: 'response',
          requestId,
          ok: true,
        }))
        return
      }

      if (message.type === 'enqueue_event') {
        ws.send(JSON.stringify({
          type: 'response',
          requestId,
          ok: true,
        }))

        ws.send(JSON.stringify({
          type: 'event',
          eventName: 'nextv_error',
          payload: {
            message: 'Model is not configured',
            code: 'AGENT_MODEL_NOT_CONFIGURED',
            sourcePath: 'workflow.nrv',
            sourceLine: 12,
            statement: 'reply = model("llama3.2:latest", messages=state.conversation)',
          },
        }))
      }
    })
  })

  try {
    const result = await runProcess([
      path.join(process.cwd(), 'bin', 'nerve-send.js'),
      `ws://127.0.0.1:${port}/api/runtime/ws`,
      'user_message',
      'hello',
      '--timeout-ms',
      '3000',
    ])

    assert.equal(result.code, 1)
    assert.equal(result.stderr.includes('Model is not configured'), true)
    assert.equal(result.stderr.includes('AGENT_MODEL_NOT_CONFIGURED'), true)
    assert.equal(result.stderr.includes('workflow.nrv:12'), true)
    assert.equal(result.stderr.includes('Timed out waiting for nextv_execution event'), false)
  } finally {
    await new Promise((resolve) => wss.close(resolve))
  }
})
