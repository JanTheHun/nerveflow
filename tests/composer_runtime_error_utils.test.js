import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  buildRuntimeErrorGuidance,
  normalizeRuntimeErrorEvent,
} = require('../extensions/vscode-conversation-composer/src/runtimeErrorUtils')

test('buildRuntimeErrorGuidance handles missing assistant profile', () => {
  const guidance = buildRuntimeErrorGuidance({
    code: 'AGENT_NOT_FOUND',
    message: 'Agent profile "assistant" was not found in registry.',
  })

  assert.ok(guidance.includes('assistant profile'))
})

test('buildRuntimeErrorGuidance handles missing model reference', () => {
  const guidance = buildRuntimeErrorGuidance({
    code: 'AGENT_MISSING_MODEL_REF',
    message: 'Profile is missing model setting.',
  })

  assert.ok(guidance.includes('model alias'))
})

test('normalizeRuntimeErrorEvent returns null for non-error events', () => {
  const result = normalizeRuntimeErrorEvent({
    eventName: 'nextv_execution',
    payload: { output: { role: 'assistant', content: 'hello' } },
  })

  assert.equal(result, null)
})

test('normalizeRuntimeErrorEvent maps payload fields', () => {
  const result = normalizeRuntimeErrorEvent({
    eventName: 'nextv_error',
    timestamp: '2025-01-01T00:00:00.000Z',
    sequence: 7,
    payload: {
      code: 'AGENT_NOT_FOUND',
      message: 'Agent profile "assistant" was not found in registry.',
      sourcePath: 'conversation.nrv',
      sourceLine: 6,
      statement: 'agent("assistant")',
    },
  })

  assert.equal(result.code, 'AGENT_NOT_FOUND')
  assert.equal(result.message, 'Agent profile "assistant" was not found in registry.')
  assert.equal(result.sourcePath, 'conversation.nrv')
  assert.equal(result.sourceLine, 6)
  assert.equal(result.statement, 'agent("assistant")')
  assert.ok(result.guidance.includes('assistant profile'))
})
