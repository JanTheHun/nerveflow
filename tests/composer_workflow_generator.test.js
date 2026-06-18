import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildWorkflowSource,
  generateWorkflow,
} = require('../extensions/vscode-conversation-composer/src/workflowGenerator.js')

test('workflow source includes selected tools', () => {
  const source = buildWorkflowSource({
    model: 'qwen3-coder',
    tools: {
      enabled: ['filesystem.read', 'git.status'],
      disabled: [],
    },
  })

  assert.equal(source.includes('tools={ mode: "governed", allow: ["filesystem.read", "git.status"] }'), true)
  assert.equal(source.includes('reply = model("qwen3-coder"'), true)
  assert.equal(source.includes('on external "user_message"'), true)
})

test('workflow source omits tools argument when no tools selected', () => {
  const source = buildWorkflowSource({
    model: 'qwen3-coder',
    tools: {
      enabled: [],
      disabled: [],
    },
  })

  assert.equal(source.includes('reply = model("qwen3-coder", messages=state.messages)'), true)
  assert.equal(source.includes('tools='), false)
})

test('workflow generator writes capabilities/conversation.nrv', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-workflow-'))
  try {
    const workflowPath = await generateWorkflow(workspace, {
      model: 'llama3.1',
      tools: { enabled: ['terminal.exec'], disabled: [] },
    })

    const raw = await readFile(workflowPath, 'utf8')
    assert.equal(raw.includes('conversation.nrv'), false)
    assert.equal(raw.includes('terminal.exec'), true)
    assert.equal(raw.includes('reply = model("llama3.1"'), true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
