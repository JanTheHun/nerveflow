import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'

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
