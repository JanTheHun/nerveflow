import test from 'node:test'
import assert from 'node:assert/strict'
import {
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  buildAgentRetryPrompt,
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

test('validateAgentReturnContract rejects additional object fields in strict mode', () => {
  assert.throws(
    () => validateAgentReturnContract(
      { intent: 'search', extra: true },
      { intent: '' },
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'extra')
      assert.equal(err.expected, 'no additional fields')
      assert.equal(err.actual, 'boolean')
      return true
    },
  )
})

test('validateAgentReturnContract preserves additional object fields in coerce mode', () => {
  const result = validateAgentReturnContract(
    { intent: 'search', extra: true },
    { intent: '' },
    'coerce',
  )

  assert.deepEqual(result, { intent: 'search', extra: true })
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

test('validateAgentReturnContract supports string enums', () => {
  const result = validateAgentReturnContract(
    { area: 'kitchen' },
    { area: ['swimming_pool', 'garage', 'front_lawn', 'dining_room', 'kitchen', 'other'] },
    'strict',
  )

  assert.deepEqual(result, { area: 'kitchen' })
})

test('validateAgentReturnContract rejects unknown enum values in strict mode', () => {
  assert.throws(
    () => validateAgentReturnContract({ area: 'blue' }, { area: ['green', 'red', 'other'] }, 'strict'),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'area')
      return true
    },
  )
})

test('validateAgentReturnContract rejects unknown enum values in coerce mode', () => {
  assert.throws(
    () => validateAgentReturnContract({ area: 'blue' }, { area: ['green', 'red', 'other'] }, 'coerce'),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'area')
      return true
    },
  )
})

test('validateAgentReturnContract rejects missing enum values in coerce mode', () => {
  assert.throws(
    () => validateAgentReturnContract({}, { area: ['green', 'red', 'other'] }, 'coerce'),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'area')
      assert.equal(err.actual, 'undefined')
      return true
    },
  )
})

test('validateAgentReturnContract rejects wildcard enum declarations', () => {
  assert.throws(
    () => validateAgentReturnContract({ area: 'other' }, { area: ['*', 'other'] }, 'strict'),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_INVALID')
      assert.equal(err.path, 'area')
      return true
    },
  )
})

test('buildAgentReturnContractGuidance produces deterministic instruction text', () => {
  const guidance = buildAgentReturnContractGuidance({ intent: '', confidence: 0 })
  assert.match(guidance, /Return only valid JSON matching this structure/)
  assert.match(guidance, /"intent": ""/)
  assert.match(guidance, /"confidence": 0/)
})

test('buildAgentReturnContractGuidance includes enum constraints', () => {
  const guidance = buildAgentReturnContractGuidance({ area: ['kitchen', 'garage', 'other'] })

  assert.match(guidance, /Enum constraints:/)
  assert.match(guidance, /area must be exactly one of:/)
  assert.match(guidance, /- kitchen/)
  assert.match(guidance, /- garage/)
  assert.match(guidance, /- other/)
  assert.match(guidance, /Return a single string literal value for area/)
  assert.match(guidance, /Do not return an array/)
  assert.match(guidance, /use "other"/)
  assert.match(guidance, /Before responding, verify area is exactly one listed literal/)
})

test('buildAgentReturnContractGuidance omits other fallback when enum does not include other', () => {
  const guidance = buildAgentReturnContractGuidance({ action: ['attack', 'retreat', 'guard'] })

  assert.match(guidance, /action must be exactly one of:/)
  assert.match(guidance, /still choose one listed value/)
  assert.doesNotMatch(guidance, /use "other"/)
})

test('buildAgentRetryPrompt generates specific feedback for field violations', () => {
  const error = {
    path: 'area',
    expected: 'enum(...)',
    actual: '"cellar"',
    message: 'enum constraint violation',
  }

  const prompt = buildAgentRetryPrompt(error)
  assert.match(prompt, /Field "area"/)
  assert.match(prompt, /enum\(\.\.\.\)/)
  assert.match(prompt, /cellar/)
  assert.match(prompt, /valid JSON object/)
})

test('buildAgentRetryPrompt generates generic feedback when error details are missing', () => {
  const error = {
    message: 'contract violation',
  }

  const prompt = buildAgentRetryPrompt(error)
  assert.match(prompt, /violated the return contract/)
  assert.match(prompt, /contract violation/)
  assert.match(prompt, /valid JSON object/)
})

test('buildAgentRetryPrompt handles null/undefined error gracefully', () => {
  const prompt1 = buildAgentRetryPrompt(null)
  assert.match(prompt1, /violated the return contract/)

  const prompt2 = buildAgentRetryPrompt(undefined)
  assert.match(prompt2, /violated the return contract/)
})

test('contract violation payload structure contains type, field, expected, actual', () => {
  try {
    validateAgentReturnContract(
      { area: 'kitchen' },
      { area: ['garage', 'other'] },
      'strict',
    )
    assert.fail('Should have thrown')
  } catch (err) {
    assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
    assert.equal(err.path, 'area')
    assert.equal(err.expected, 'enum(\"garage\" | \"other\")')
    assert.equal(err.actual, '"kitchen"')
  }
})

test('contract violation with missing field provides path and expected type', () => {
  try {
    validateAgentReturnContract(
      { },
      { status: ['ok', 'error'] },
      'strict',
    )
    assert.fail('Should have thrown')
  } catch (err) {
    assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
    assert.equal(err.path, 'status')
    assert.equal(err.actual, 'undefined')
  }
})