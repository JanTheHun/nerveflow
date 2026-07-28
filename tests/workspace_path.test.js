import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeWorkspacePath } from '../nerve-studio/public/src-app/workspace_path.js'

test('normalizeWorkspacePath preserves Linux absolute paths', () => {
  assert.equal(normalizeWorkspacePath('/home/min/prog/nerveflow/examples/chatbot-workflow'), '/home/min/prog/nerveflow/examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('/home/min/prog/nerveflow/examples/chatbot-workflow/'), '/home/min/prog/nerveflow/examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('/'), '/')
})

test('normalizeWorkspacePath preserves Windows absolute paths', () => {
  assert.equal(normalizeWorkspacePath('C:/repo/nerveflow/examples/chatbot-workflow'), 'C:/repo/nerveflow/examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('C:\\repo\\nerveflow\\examples\\chatbot-workflow\\'), 'C:/repo/nerveflow/examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('C:/'), 'C:/')
})

test('normalizeWorkspacePath keeps relative workspace paths relative', () => {
  assert.equal(normalizeWorkspacePath('./examples/chatbot-workflow'), 'examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('examples//chatbot-workflow///'), 'examples/chatbot-workflow')
  assert.equal(normalizeWorkspacePath('workspaces-local/chatbot'), 'workspaces-local/chatbot')
})

test('normalizeWorkspacePath handles empty and dot-only values', () => {
  assert.equal(normalizeWorkspacePath(''), '')
  assert.equal(normalizeWorkspacePath('   '), '')
  assert.equal(normalizeWorkspacePath('.'), '')
  assert.equal(normalizeWorkspacePath('./'), '')
})