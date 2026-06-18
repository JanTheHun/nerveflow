import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { WebSocketServer } from 'ws'

const require = createRequire(import.meta.url)
const {
  ComposerClient,
} = require('../extensions/vscode-conversation-composer/src/composerClient.js')

test('composer client falls back to external endpoint when embedded runtime bundle cannot load', async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'composer-client-'))
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'composer-client-session-'))
  const badModulePath = path.join(workspaceDir, 'missing-embedded-runtime.mjs')

  const port = 45937
  const endpoint = `ws://127.0.0.1:${port}/api/runtime/ws`

  const server = new WebSocketServer({
    port,
    path: '/api/runtime/ws',
  })

  server.on('connection', (socket) => {
    socket.on('message', (raw) => {
      let envelope
      try {
        envelope = JSON.parse(String(raw || '{}'))
      } catch {
        return
      }

      if (envelope?.type === 'subscribe' && envelope.requestId) {
        socket.send(JSON.stringify({
          type: 'response',
          ok: true,
          requestId: envelope.requestId,
          sessionId: 'session-test',
          payload: {},
        }))
      }
    })
  })

  const errors = []
  const client = new ComposerClient({
    getEndpoint: () => endpoint,
    getWorkspaceDir: () => workspaceDir,
    getSessionRoot: () => sessionRoot,
    getDefaultModel: () => 'qwen3-coder',
    embeddedRuntimeModulePath: badModulePath,
  })

  client.on('error', (event) => {
    errors.push(String(event?.message || ''))
  })

  try {
    const result = await client.connect()
    assert.equal(result.connected, true)
    assert.equal(errors.some((message) => message.includes('Unable to load embedded runtime bundle')), true)
  } finally {
    await client.disconnect()
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(sessionRoot, { recursive: true, force: true })
  }
})
