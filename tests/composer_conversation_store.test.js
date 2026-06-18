import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  appendConversationMessages,
  loadConversation,
  clearConversation,
} = require('../extensions/vscode-conversation-composer/src/conversationStore.js')

test('conversation store appends and reloads messages', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-conversation-'))
  try {
    const relPath = 'conversations/default.jsonl'
    await appendConversationMessages(workspace, relPath, [
      { role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ])
    await appendConversationMessages(workspace, relPath, [
      { role: 'assistant', content: 'hi', timestamp: '2026-01-01T00:00:01.000Z' },
    ])

    const loaded = await loadConversation(workspace, relPath)
    assert.equal(loaded.length, 2)
    assert.equal(loaded[0].role, 'user')
    assert.equal(loaded[1].role, 'assistant')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('conversation store clear resets history', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-conversation-clear-'))
  try {
    const relPath = 'conversations/default.jsonl'
    await appendConversationMessages(workspace, relPath, [
      { role: 'user', content: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ])

    await clearConversation(workspace, relPath)
    const loaded = await loadConversation(workspace, relPath)
    assert.equal(loaded.length, 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
