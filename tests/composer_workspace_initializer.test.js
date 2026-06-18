import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  initializeWorkspace,
} = require('../extensions/vscode-conversation-composer/src/workspaceInitializer.js')

test('initializeWorkspace seeds runtime config files for embedded composer host', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-init-'))
  try {
    await initializeWorkspace(workspace, ['qwen3-coder', 'llama3.1'])

    const nextvRaw = await readFile(path.join(workspace, 'nextv.json'), 'utf8')
    const modelsRaw = await readFile(path.join(workspace, 'models.json'), 'utf8')
    const transportsRaw = await readFile(path.join(workspace, 'transports.json'), 'utf8')

    const nextv = JSON.parse(nextvRaw)
    const models = JSON.parse(modelsRaw)
    const transports = JSON.parse(transportsRaw)

    assert.equal(nextv.entrypointPath, 'capabilities/conversation.nrv')
    assert.equal(nextv.modelsConfig, 'models.json')
    assert.equal(nextv.transportsConfig, 'transports.json')

    assert.equal(models['qwen3-coder'].transport, 'composer-default')
    assert.equal(models['llama3.1'].transport, 'composer-default')
    assert.equal(transports['composer-default'].provider, 'ollama')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('session initialization does not modify target project folder', async () => {
  const projectFolder = await mkdtemp(path.join(os.tmpdir(), 'composer-project-'))
  const sessionRoot = await mkdtemp(path.join(os.tmpdir(), 'composer-session-'))
  try {
    await initializeWorkspace(sessionRoot, ['qwen3-coder'])

    const projectEntries = await readdir(projectFolder)
    assert.deepEqual(projectEntries, [])
  } finally {
    await rm(projectFolder, { recursive: true, force: true })
    await rm(sessionRoot, { recursive: true, force: true })
  }
})
