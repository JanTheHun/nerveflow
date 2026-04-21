import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendAgentFormatInstructions,
  extractCodeOutput,
  extractJsonOutput,
  extractTextOutput,
  normalizeAgentFormattedOutput,
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