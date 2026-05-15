import test from 'node:test'
import assert from 'node:assert/strict'

import { validateJson } from '../packages/editor-core/src/index.js'

test('validateJson returns no diagnostics for valid json', () => {
  const diagnostics = validateJson('{"a":1,"b":[true,false,null]}')
  assert.deepEqual(diagnostics, [])
})

test('validateJson reports parse errors with line and column', () => {
  const diagnostics = validateJson([
    '{',
    '  "a": 1',
    '  "b": 2',
    '}',
  ].join('\n'))

  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].code, 'JSON_PARSE_ERROR')
  assert.equal(diagnostics[0].severity, 'error')
  assert.equal(typeof diagnostics[0].line, 'number')
  assert.equal(typeof diagnostics[0].column, 'number')
})

test('validateJson warns for empty document', () => {
  const diagnostics = validateJson('   \n  ')
  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].code, 'JSON_EMPTY_DOCUMENT')
  assert.equal(diagnostics[0].severity, 'warning')
})
