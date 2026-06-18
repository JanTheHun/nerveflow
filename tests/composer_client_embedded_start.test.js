import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ComposerClient } = require('../extensions/vscode-conversation-composer/src/composerClient.js')
const { initializeWorkspace } = require('../extensions/vscode-conversation-composer/src/workspaceInitializer.js')

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

test('composer client can connect using embedded runtime without external server', async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'composer-embedded-project-'))
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'composer-embedded-session-'))
  const port = await reserveFreePort()
  const endpoint = `ws://127.0.0.1:${port}/api/runtime/ws`

  await initializeWorkspace(sessionRoot, ['qwen3-coder'])

  const client = new ComposerClient({
    getEndpoint: () => endpoint,
    getWorkspaceDir: () => workspaceDir,
    getSessionRoot: () => sessionRoot,
    getDefaultModel: () => 'qwen3-coder',
  })

  try {
    const result = await client.connect()
    assert.equal(result.connected, true)
  } finally {
    await client.disconnect()
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(sessionRoot, { recursive: true, force: true })
  }
})

test('composer client auto-initializes session config when entrypoint is missing', async () => {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'composer-embedded-project-autoinit-'))
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'composer-embedded-session-autoinit-'))
  const port = await reserveFreePort()
  const endpoint = `ws://127.0.0.1:${port}/api/runtime/ws`

  const client = new ComposerClient({
    getEndpoint: () => endpoint,
    getWorkspaceDir: () => workspaceDir,
    getSessionRoot: () => sessionRoot,
    getDefaultModel: () => 'qwen3-coder',
  })

  try {
    const result = await client.connect()
    assert.equal(result.connected, true)

    const workspaceEntries = await readdir(workspaceDir)
    assert.deepEqual(workspaceEntries, [])
  } finally {
    await client.disconnect()
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(sessionRoot, { recursive: true, force: true })
  }
})
