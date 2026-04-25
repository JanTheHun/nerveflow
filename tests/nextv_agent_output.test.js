import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  extractCodeOutput,
  extractJsonOutput,
  extractTextOutput,
  normalizeAgentFormattedOutput,
  validateAgentReturnContract,
} from '../src/index.js'

test('appendAgentFormatInstructions appends deterministic format contract', () => {
  const result = appendAgentFormatInstructions('Classify this message', 'json')

  assert.equal(result.startsWith('Classify this message'), true)
  assert.equal(result.includes('Format contract:'), true)
  assert.equal(result.includes('Return only valid JSON.'), true)
})

test('extractJsonOutput parses direct JSON and fenced JSON blocks', () => {
  assert.deepEqual(extractJsonOutput('{"intent":"chat"}'), { intent: 'chat' })
  assert.deepEqual(
    extractJsonOutput('Here is the result:\n```json\n{"intent":"chat","score":0.9}\n```'),
    { intent: 'chat', score: 0.9 },
  )
})

test('extractJsonOutput falls back to first balanced JSON substring', () => {
  const result = extractJsonOutput('Answer: {"intent":"chat","meta":{"topic":"support"}} thanks')

  assert.equal(result.intent, 'chat')
  assert.equal(result.meta.topic, 'support')
})

test('extractJsonOutput throws JSON_PARSE_ERROR for invalid content', () => {
  assert.throws(
    () => extractJsonOutput('not-json'),
    (err) => {
      assert.equal(err.code, 'JSON_PARSE_ERROR')
      return true
    },
  )
})

test('extractCodeOutput returns first fenced code block when present', () => {
  const result = extractCodeOutput('Here you go:\n```js\nconst x = 1\n```\nMore text')
  assert.equal(result, 'const x = 1')
})

test('extractTextOutput strips fences markdown and filler phrases conservatively', () => {
  const result = extractTextOutput('Sure, **Answer**:\n```text\nhello there\n```')
  assert.equal(result, 'Answer:\nhello there')
})

test('normalizeAgentFormattedOutput dispatches by format', () => {
  assert.equal(normalizeAgentFormattedOutput('Sure, hello', 'text'), 'hello')
  assert.equal(normalizeAgentFormattedOutput('```py\nprint(1)\n```', 'code'), 'print(1)')
  assert.deepEqual(normalizeAgentFormattedOutput('{"ok":true}', 'json'), { ok: true })
})

test('validateAgentReturnContract enforces strict shape recursively', () => {
  assert.throws(
    () => validateAgentReturnContract(
      { intent: 'search', meta: {} },
      { intent: '', meta: { source: '' } },
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'meta.source')
      assert.equal(err.expected, 'string')
      assert.equal(err.actual, 'undefined')
      return true
    },
  )
})

test('validateAgentReturnContract repairs missing structure in coerce mode', () => {
  const result = validateAgentReturnContract(
    { intent: 'search', meta: null, entities: null },
    { intent: '', meta: { source: '', score: 0 }, entities: [{ name: '', kind: '' }] },
    'coerce',
  )

  assert.deepEqual(result, {
    intent: 'search',
    meta: { source: '', score: 0 },
    entities: [],
  })
})

test('buildAgentReturnContractGuidance produces deterministic instruction text', () => {
  const guidance = buildAgentReturnContractGuidance({ intent: '', confidence: 0 })
  assert.match(guidance, /Return only valid JSON matching this structure/)
  assert.match(guidance, /"intent": ""/)
  assert.match(guidance, /"confidence": 0/)
})