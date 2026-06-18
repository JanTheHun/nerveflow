import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  initializeConfig,
  loadConfig,
  saveConfig,
  getConfigPath,
} = require('../extensions/vscode-conversation-composer/src/composerConfig.js')

test('composer config initializes and loads defaults', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-config-'))
  try {
    const config = await initializeConfig(workspace, ['test-model'])
    assert.equal(config.model, 'test-model')

    const loaded = await loadConfig(workspace)
    assert.equal(loaded.model, 'test-model')
    assert.equal(Array.isArray(loaded.system), true)
    assert.equal(Array.isArray(loaded.tools.enabled), true)

    const raw = await readFile(getConfigPath(workspace), 'utf8')
    assert.equal(raw.includes('"version": "1.0"'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('composer config save normalizes slashes', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-config-save-'))
  try {
    await initializeConfig(workspace, ['qwen3-coder'])
    const saved = await saveConfig(workspace, {
      version: '1.0',
      model: 'qwen3-coder',
      system: ['system\\coding.md'],
      tools: { enabled: ['git.status'], disabled: [] },
      conversation: 'conversations\\default.jsonl',
    })

    assert.deepEqual(saved.system, ['system/coding.md'])
    assert.equal(saved.conversation, 'conversations/default.jsonl')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
