import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Surface,
  Renderer,
  DiagnosticsChannel,
  tokenizeJson,
  createJsonPlugin,
} from '../packages/editor-core/src/index.js'

test('tokenizeJson emits structural token types', () => {
  const tokens = tokenizeJson('{"ok":true,"arr":[1,2]}')
  const types = new Set(tokens.map((token) => token.type))
  assert.equal(types.has('brace-open'), true)
  assert.equal(types.has('string'), true)
  assert.equal(types.has('boolean'), true)
  assert.equal(types.has('bracket-open'), true)
  assert.equal(types.has('number'), true)
})

test('json plugin attaches, validates, and updates renderer tokens', () => {
  const surface = new Surface({ text: '{"a":1}' })
  const renderer = new Renderer()
  const diagnostics = new DiagnosticsChannel()
  const plugin = createJsonPlugin({ trailingNewline: false })

  const detach = plugin.attach({ surface, renderer, diagnosticsChannel: diagnostics })
  assert.equal(renderer.getTokens().length > 0, true)
  assert.deepEqual(diagnostics.getDiagnostics(), [])

  surface.setText('{"a": }')
  const current = diagnostics.getDiagnostics()
  assert.equal(current.length, 1)
  assert.equal(current[0].code, 'JSON_PARSE_ERROR')

  detach()
})

test('json commands mutate object and array structure deterministically', () => {
  const surface = new Surface({ text: '{"obj":{"flag":true},"arr":[1,2]}' })
  const plugin = createJsonPlugin({ trailingNewline: false })
  const detach = plugin.attach({ surface })

  const addProperty = surface.dispatchCommand('json.addProperty', {
    path: ['obj'],
    key: 'newKey',
    value: 'x',
  })
  assert.equal(addProperty.ok, true)
  assert.equal(addProperty.value.ok, true)

  const renameKey = surface.dispatchCommand('json.renameKey', {
    path: ['obj'],
    fromKey: 'newKey',
    toKey: 'renamed',
  })
  assert.equal(renameKey.ok, true)
  assert.equal(renameKey.value.ok, true)

  const toggle = surface.dispatchCommand('json.toggleBoolean', {
    path: ['obj', 'flag'],
  })
  assert.equal(toggle.ok, true)
  assert.equal(toggle.value.ok, true)

  const addItem = surface.dispatchCommand('json.addArrayItem', {
    path: ['arr'],
    value: 3,
  })
  assert.equal(addItem.ok, true)
  assert.equal(addItem.value.ok, true)

  const removeItem = surface.dispatchCommand('json.removeArrayItem', {
    path: ['arr'],
    index: 1,
  })
  assert.equal(removeItem.ok, true)
  assert.equal(removeItem.value.ok, true)

  const parsed = JSON.parse(surface.getText())
  assert.deepEqual(parsed.obj, { flag: false, renamed: 'x' })
  assert.deepEqual(parsed.arr, [1, 3])

  detach()
})

test('json normalizeDocument command returns stable formatted json', () => {
  const surface = new Surface({ text: '{"a":1,"b":{"c":2}}' })
  const plugin = createJsonPlugin({ trailingNewline: false, indent: 2 })
  const detach = plugin.attach({ surface })

  const result = surface.dispatchCommand('json.normalizeDocument')
  assert.equal(result.ok, true)
  assert.equal(result.value.ok, true)
  assert.match(surface.getText(), /\n  "a": 1,\n/)

  detach()
})

test('json toggleBoolean can operate at cursor without path', () => {
  const surface = new Surface({ text: '{"ok": true}' })
  const plugin = createJsonPlugin({ trailingNewline: false })
  const detach = plugin.attach({ surface })

  const cursor = surface.getText().indexOf('true') + 1
  surface.setSelection(cursor, cursor)
  const result = surface.dispatchCommand('json.toggleBoolean')

  assert.equal(result.ok, true)
  assert.equal(result.value.ok, true)
  assert.equal(JSON.parse(surface.getText()).ok, false)

  detach()
})

test('json toggleBoolean rejects cursor inside string', () => {
  const surface = new Surface({ text: '{"label":"true"}' })
  const plugin = createJsonPlugin({ trailingNewline: false })
  const detach = plugin.attach({ surface })

  const cursor = surface.getText().indexOf('true') + 1
  surface.setSelection(cursor, cursor)
  const result = surface.dispatchCommand('json.toggleBoolean')

  assert.equal(result.ok, true)
  assert.equal(result.value.ok, false)
  assert.equal(result.value.reason, 'cursor-inside-string')
  assert.equal(JSON.parse(surface.getText()).label, 'true')

  detach()
})

test('json setValue supports root path replacement', () => {
  const surface = new Surface({ text: '{"a":1}' })
  const plugin = createJsonPlugin({ trailingNewline: false })
  const detach = plugin.attach({ surface })

  const result = surface.dispatchCommand('json.setValue', {
    path: [],
    value: ['x', 'y'],
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.ok, true)
  assert.deepEqual(JSON.parse(surface.getText()), ['x', 'y'])

  detach()
})

test('json normalizeSelection formats selected json fragment', () => {
  const surface = new Surface({
    text: [
      '{',
      '  "config": {"a":1,"b":2},',
      '  "other": 3',
      '}',
    ].join('\n'),
  })
  const plugin = createJsonPlugin({ trailingNewline: false })
  const detach = plugin.attach({ surface })

  const text = surface.getText()
  const start = text.indexOf('{"a":1,"b":2}')
  const end = start + '{"a":1,"b":2}'.length
  surface.setSelection(start, end)

  const result = surface.dispatchCommand('json.normalizeSelection', { indent: 2, normalizeBoundary: false })

  assert.equal(result.ok, true)
  assert.equal(result.value.ok, true)
  assert.match(surface.getText(), /"config": \{\n    "a": 1,\n    "b": 2\n  \},/)

  detach()
})
