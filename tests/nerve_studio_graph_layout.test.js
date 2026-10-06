import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAPH_LAYOUT_STORAGE_KEY,
  getGraphWorkspaceBounds,
  getGraphLayoutScope,
  loadGraphLayoutPositions,
  loadGraphFileOffsets,
  saveGraphLayoutPosition,
  saveGraphFileOffset,
  clearGraphLayoutPositions,
  applyGraphLayoutPositions,
  applyGraphFileOffsets,
  getClippedGraphEdgeLine,
} from '../nerve-studio/public/src-app/graph_layout.js'

function makeStorage(initialValue = null) {
  const values = new Map()
  if (initialValue !== null) values.set(GRAPH_LAYOUT_STORAGE_KEY, initialValue)
  return {
    getItem(key) {
      return values.get(key) ?? null
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

test('graph workspace bounds include negative positions with a stable margin', () => {
  assert.deepEqual(
    getGraphWorkspaceBounds([
      { x: -180, y: -90, width: 120, height: 60 },
      { x: 80, y: 40, width: 100, height: 50 },
    ], { marginX: 20, marginY: 30, minimumWidth: 1, minimumHeight: 1 }),
    { x: -200, y: -120, width: 400, height: 240 },
  )
})

test('graph workspace bounds retain the minimum workspace around positive layouts', () => {
  assert.deepEqual(
    getGraphWorkspaceBounds([{ x: 40, y: 80, width: 100, height: 50 }]),
    { x: -40, y: -40, width: 520, height: 320 },
  )
})

test('graph layout positions are isolated by workspace, entrypoint, and direction', () => {
  const storage = makeStorage()
  const topDownScope = getGraphLayoutScope('/workspace', 'flow.nrv', 'TB')
  const leftRightScope = getGraphLayoutScope('/workspace', 'flow.nrv', 'LR')

  assert.equal(saveGraphLayoutPosition(storage, topDownScope, 'handler:start', { x: 42.4, y: 91.7 }), true)
  assert.deepEqual(loadGraphLayoutPositions(storage, topDownScope).get('handler:start'), { x: 42, y: 92 })
  assert.equal(loadGraphLayoutPositions(storage, leftRightScope).size, 0)
})

test('file layout offsets round-trip and move only their grouped nodes', () => {
  const storage = makeStorage()
  const scope = getGraphLayoutScope('/workspace', 'flow.nrv', 'TB')
  assert.equal(saveGraphLayoutPosition(storage, scope, 'handler:start', { x: 42, y: 92 }), true)
  assert.equal(saveGraphFileOffset(storage, scope, 'handlers.nrv', { x: 140.4, y: -20.7 }), true)
  assert.deepEqual(loadGraphLayoutPositions(storage, scope).get('handler:start'), { x: 42, y: 92 })
  assert.deepEqual(loadGraphFileOffsets(storage, scope).get('handlers.nrv'), { x: 140, y: -21 })

  const positions = new Map([
    ['handler:start', { x: 42, y: 92 }],
    ['handler:next', { x: 120, y: 180 }],
    ['handler:other', { x: 280, y: 180 }],
  ])
  const groups = new Map([
    ['handler:start', 'handlers.nrv'],
    ['handler:next', 'handlers.nrv'],
    ['handler:other', 'other.nrv'],
  ])
  assert.equal(applyGraphFileOffsets(positions, groups, loadGraphFileOffsets(storage, scope)), 2)
  assert.deepEqual(positions.get('handler:start'), { x: 182, y: 71 })
  assert.deepEqual(positions.get('handler:next'), { x: 260, y: 159 })
  assert.deepEqual(positions.get('handler:other'), { x: 280, y: 180 })
})

test('graph layout ignores malformed storage and stale node overrides', () => {
  const storage = makeStorage('{invalid json')
  const scope = getGraphLayoutScope('', 'flow.nrv', 'TB')
  assert.equal(loadGraphLayoutPositions(storage, scope).size, 0)

  const positions = new Map([['handler:start', { x: 10, y: 20 }]])
  const overrides = new Map([
    ['handler:start', { x: 30, y: 40 }],
    ['handler:removed', { x: 50, y: 60 }],
  ])
  assert.equal(applyGraphLayoutPositions(positions, overrides), 1)
  assert.deepEqual(positions.get('handler:start'), { x: 30, y: 40 })
  assert.equal(positions.has('handler:removed'), false)
})

test('graph layout reset removes only the active scope', () => {
  const storage = makeStorage()
  const firstScope = getGraphLayoutScope('/workspace', 'first.nrv', 'TB')
  const secondScope = getGraphLayoutScope('/workspace', 'second.nrv', 'TB')
  saveGraphLayoutPosition(storage, firstScope, 'handler:first', { x: 10, y: 20 })
  saveGraphLayoutPosition(storage, secondScope, 'handler:second', { x: 30, y: 40 })

  assert.equal(clearGraphLayoutPositions(storage, firstScope), true)
  assert.equal(loadGraphLayoutPositions(storage, firstScope).size, 0)
  assert.equal(loadGraphLayoutPositions(storage, secondScope).size, 1)
})

test('drag preview line clips both ends against node boundaries', () => {
  assert.deepEqual(
    getClippedGraphEdgeLine(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { shape: 'rounded-rect', width: 40, height: 30 },
      { shape: 'rounded-rect', width: 60, height: 40 },
    ),
    { x1: 20, y1: 0, x2: 70, y2: 0 },
  )
  assert.deepEqual(
    getClippedGraphEdgeLine(
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { shape: 'circle', width: 20, height: 20 },
      { shape: 'circle', width: 30, height: 30 },
    ),
    { x1: 0, y1: 10, x2: 0, y2: 85 },
  )
  assert.deepEqual(
    getClippedGraphEdgeLine(
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { shape: 'rounded-rect', width: 100, height: 40 },
      { shape: 'rounded-rect', width: 80, height: 60 },
    ),
    { x1: 20, y1: 20, x2: 70, y2: 70 },
  )
})