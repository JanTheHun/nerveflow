import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Surface,
  Renderer,
  DiagnosticsChannel,
} from '../packages/editor-core/src/index.js'

test('Surface supports insert, replace, delete, undo, redo', () => {
  const surface = new Surface({ text: 'hello' })

  assert.equal(surface.insertText(5, ' world'), true)
  assert.equal(surface.getText(), 'hello world')

  assert.equal(surface.replaceRange(6, 11, 'Nerveflow'), true)
  assert.equal(surface.getText(), 'hello Nerveflow')

  assert.equal(surface.deleteRange(0, 6), true)
  assert.equal(surface.getText(), 'Nerveflow')

  assert.equal(surface.undo(), true)
  assert.equal(surface.getText(), 'hello Nerveflow')

  assert.equal(surface.undo(), true)
  assert.equal(surface.getText(), 'hello world')

  assert.equal(surface.redo(), true)
  assert.equal(surface.getText(), 'hello Nerveflow')
})

test('Surface enforces readonly mode', () => {
  const surface = new Surface({ text: 'fixed', readonly: true })

  assert.equal(surface.setText('new'), false)
  assert.equal(surface.insertText(0, 'X'), false)
  assert.equal(surface.replaceRange(0, 1, 'x'), false)
  assert.equal(surface.deleteRange(0, 1), false)
  assert.equal(surface.undo(), false)
  assert.equal(surface.redo(), false)
  assert.equal(surface.getText(), 'fixed')
})

test('Surface selection and commands are host-addressable', () => {
  const surface = new Surface({ text: 'abcd' })

  assert.deepEqual(surface.setSelection(4, 1), { start: 1, end: 4 })
  assert.deepEqual(surface.getSelection(), { start: 1, end: 4 })

  const dispose = surface.registerCommand('append-exclamation', ({ surface: s, payload }) => {
    s.insertText(s.getText().length, payload)
    return s.getText()
  })

  assert.deepEqual(surface.listCommands(), ['append-exclamation'])
  assert.deepEqual(surface.dispatchCommand('append-exclamation', '!'), {
    ok: true,
    value: 'abcd!',
  })
  assert.equal(surface.getText(), 'abcd!')

  dispose()
  assert.deepEqual(surface.listCommands(), [])
  assert.deepEqual(surface.dispatchCommand('append-exclamation', '!'), {
    ok: false,
    reason: 'unknown-command',
  })
})

test('Renderer stores tokens and overlays by line', () => {
  const renderer = new Renderer()

  renderer.setTokens([
    { line: 1, start: 0, end: 2, type: 'keyword', value: 'on' },
    { line: 2, start: 0, end: 5, type: 'identifier', value: 'event' },
  ])

  renderer.setOverlays([
    { line: 2, kind: 'diagnostic', severity: 'warning', message: 'sample' },
  ])

  assert.equal(renderer.getTokens().length, 2)
  assert.deepEqual(renderer.getTokensForLine(1), [
    { line: 1, start: 0, end: 2, type: 'keyword', value: 'on' },
  ])
  assert.equal(renderer.getOverlays().length, 1)
})

test('DiagnosticsChannel publishes immutable snapshots', () => {
  const channel = new DiagnosticsChannel()
  const seen = []

  const unsubscribe = channel.subscribe((items) => {
    seen.push(items)
  })

  channel.setDiagnostics([
    { severity: 'error', message: 'missing end', line: 9, column: 1 },
  ])

  const snapshot = channel.getDiagnostics()
  assert.equal(snapshot.length, 1)
  snapshot[0].message = 'mutated'

  assert.equal(channel.getDiagnostics()[0].message, 'missing end')

  channel.addDiagnostic({ severity: 'warning', message: 'unused var', line: 2, column: 3 })
  assert.equal(channel.getDiagnostics().length, 2)

  channel.clear()
  assert.deepEqual(channel.getDiagnostics(), [])
  assert.ok(seen.length >= 3)

  unsubscribe()
})
