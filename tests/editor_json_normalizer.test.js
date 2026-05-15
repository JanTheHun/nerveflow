import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeJson } from '../packages/editor-core/src/index.js'

test('normalizeJson formats valid json with default indent', () => {
  const normalized = normalizeJson('{"a":1,"b":{"c":2}}')
  assert.equal(normalized, [
    '{',
    '  "a": 1,',
    '  "b": {',
    '    "c": 2',
    '  }',
    '}',
  ].join('\n'))
})

test('normalizeJson can append trailing newline', () => {
  const normalized = normalizeJson('{"a":1}', { trailingNewline: true })
  assert.equal(normalized.endsWith('\n'), true)
})

test('normalizeJson throws JSON_PARSE_ERROR for invalid json', () => {
  assert.throws(() => normalizeJson('{"a":}'), (error) => {
    assert.equal(error?.code, 'JSON_PARSE_ERROR')
    return true
  })
})
