import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRAPH_LAYOUT_STORAGE_KEY,
  getGraphLayoutScope,
  loadGraphLayoutPositions,
  saveGraphLayoutPosition,
  clearGraphLayoutPositions,
  applyGraphLayoutPositions,
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

test('graph layout positions are isolated by workspace, entrypoint, and direction', () => {
  const storage = makeStorage()
  const topDownScope = getGraphLayoutScope('/workspace', 'flow.nrv', 'TB')
  const leftRightScope = getGraphLayoutScope('/workspace', 'flow.nrv', 'LR')

  assert.equal(saveGraphLayoutPosition(storage, topDownScope, 'handler:start', { x: 42.4, y: 91.7 }), true)
  assert.deepEqual(loadGraphLayoutPositions(storage, topDownScope).get('handler:start'), { x: 42, y: 92 })
  assert.equal(loadGraphLayoutPositions(storage, leftRightScope).size, 0)
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