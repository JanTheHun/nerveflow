import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'

function loadTimerApi() {
  const scriptPath = resolve(process.cwd(), 'nerve-studio/public/nextv_graph_timer_api.js')
  const source = readFileSync(scriptPath, 'utf8')
  const sandbox = { globalThis: {} }
  vm.runInNewContext(source, sandbox, { filename: scriptPath })
  const api = sandbox.globalThis.nextVGraphTimerApi
  assert.ok(api, 'expected nextVGraphTimerApi to be attached to globalThis')
  return api
}

function makeState(overrides = {}) {
  return {
    runtimeAgentCallTimersByNode: new Map(),
    runtimeAgentTickerId: null,
    ...overrides,
  }
}

function makeWin() {
  let nextId = 1
  const intervals = new Map()
  return {
    setInterval(fn, ms) {
      const id = nextId++
      intervals.set(id, { fn, ms })
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
    _intervals: intervals,
  }
}

// --- syncTicker ---

test('syncTicker starts interval when at least one active timer exists', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()
  const updateCalls = []

  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: Date.now(), elapsedMs: 0 })

  api.syncTicker(state, win, () => updateCalls.push(1))

  assert.ok(state.runtimeAgentTickerId != null, 'expected tickerId to be set')
  assert.equal(win._intervals.size, 1, 'expected one active interval')
})

test('syncTicker does not create duplicate interval when already running', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: Date.now(), elapsedMs: 0 })

  api.syncTicker(state, win, () => {})
  const firstId = state.runtimeAgentTickerId

  api.syncTicker(state, win, () => {})

  assert.equal(state.runtimeAgentTickerId, firstId, 'expected tickerId to remain unchanged')
  assert.equal(win._intervals.size, 1, 'expected still only one interval')
})

test('syncTicker stops interval when no active timers remain', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  // Start with an active timer, then sync to start the ticker
  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: Date.now(), elapsedMs: 0 })
  api.syncTicker(state, win, () => {})
  assert.ok(state.runtimeAgentTickerId != null)

  // Mark timer inactive, then sync to stop the ticker
  state.runtimeAgentCallTimersByNode.set('node-a', { active: false, startMs: 0, elapsedMs: 500 })
  api.syncTicker(state, win, () => {})

  assert.equal(state.runtimeAgentTickerId, null, 'expected tickerId to be cleared')
  assert.equal(win._intervals.size, 0, 'expected interval to be removed')
})

test('syncTicker does nothing when no timers exist and no interval is running', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  api.syncTicker(state, win, () => {})

  assert.equal(state.runtimeAgentTickerId, null)
  assert.equal(win._intervals.size, 0)
})

// --- finalizeActive ---

test('finalizeActive marks active timers as stopped and records elapsedMs', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  const startMs = 1000
  const nowMs = 1800
  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs, elapsedMs: 0 })

  const count = api.finalizeActive(state, {}, () => nowMs, win, () => {})

  assert.equal(count, 1)
  const timerState = state.runtimeAgentCallTimersByNode.get('node-a')
  assert.equal(timerState.active, false)
  assert.equal(timerState.elapsedMs, 800)
  assert.equal(timerState.startMs, startMs)
})

test('finalizeActive skips already-inactive timers', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  state.runtimeAgentCallTimersByNode.set('node-a', { active: false, startMs: 0, elapsedMs: 200 })

  const count = api.finalizeActive(state, {}, () => 2000, win, () => {})

  assert.equal(count, 0)
  // Unchanged
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-a').elapsedMs, 200)
})

test('finalizeActive handles multiple active timers', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()
  const nowMs = 5000

  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: 4000, elapsedMs: 0 })
  state.runtimeAgentCallTimersByNode.set('node-b', { active: true, startMs: 4500, elapsedMs: 0 })
  state.runtimeAgentCallTimersByNode.set('node-c', { active: false, startMs: 4000, elapsedMs: 300 })

  const count = api.finalizeActive(state, {}, () => nowMs, win, () => {})

  assert.equal(count, 2)
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-a').elapsedMs, 1000)
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-b').elapsedMs, 500)
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-c').elapsedMs, 300, 'inactive timer unchanged')
})

test('finalizeActive respects elapsedMs override (takes max)', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  // computedElapsed = 1000 - 800 = 200ms; override = 3500ms — override wins
  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: 800, elapsedMs: 0 })

  const count = api.finalizeActive(state, { elapsedMs: 3500 }, () => 1000, win, () => {})

  assert.equal(count, 1)
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-a').elapsedMs, 3500)
})

test('finalizeActive uses computed elapsed when larger than override', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  // computedElapsed = 5000 - 0 = 5000ms; override = 100ms — computed wins
  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: 0, elapsedMs: 0 })

  const count = api.finalizeActive(state, { elapsedMs: 100 }, () => 5000, win, () => {})

  assert.equal(count, 1)
  assert.equal(state.runtimeAgentCallTimersByNode.get('node-a').elapsedMs, 5000)
})

test('finalizeActive stops the ticker after all timers are finalized', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: 0, elapsedMs: 0 })
  // Manually simulate a running ticker
  state.runtimeAgentTickerId = win.setInterval(() => {}, 120)

  api.finalizeActive(state, {}, () => 1000, win, () => {})

  assert.equal(state.runtimeAgentTickerId, null, 'expected ticker to be cleared after finalization')
  assert.equal(win._intervals.size, 0)
})

test('finalizeActive calls onUpdate when timers are finalized', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()
  let updateCount = 0

  state.runtimeAgentCallTimersByNode.set('node-a', { active: true, startMs: 0, elapsedMs: 0 })

  api.finalizeActive(state, {}, () => 500, win, () => { updateCount++ })

  assert.ok(updateCount > 0, 'expected onUpdate to be called')
})

test('finalizeActive does not call onUpdate when no timers were active', () => {
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()
  let updateCount = 0

  // No active timers
  state.runtimeAgentCallTimersByNode.set('node-a', { active: false, startMs: 0, elapsedMs: 100 })

  api.finalizeActive(state, {}, () => 500, win, () => { updateCount++ })

  assert.equal(updateCount, 0)
})

// --- view-switch regression ---

test('timer state survives a simulated view-switch (runtimeAgentCallTimersByNode not cleared)', () => {
  // Regression guard: clearNextVGraphOutput() must NOT call
  // runtimeAgentCallTimersByNode.clear(). This test verifies that after a
  // simulated re-render (which clears other graph output but not the timer Map),
  // finalizeActive can still find and finalize the active timer.
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  const startMs = 1000
  state.runtimeAgentCallTimersByNode.set('intent-agent', { active: true, startMs, elapsedMs: 0 })

  // Simulate what clearNextVGraphOutput NOW does — does NOT clear runtimeAgentCallTimersByNode.
  // (The ticker id IS cleared and will be restarted by syncNextVGraphAgentTicker post-render.)
  if (state.runtimeAgentTickerId) {
    win.clearInterval(state.runtimeAgentTickerId)
    state.runtimeAgentTickerId = null
  }
  // agentTimerLabelElements.clear() and DOM rebuild happen here in the real code,
  // but runtimeAgentCallTimersByNode is intentionally left intact.

  // After the re-render, syncTicker is called to re-attach the ticker
  api.syncTicker(state, win, () => {})
  assert.ok(state.runtimeAgentTickerId != null, 'expected ticker to restart after view-switch')

  // The timer is still active — finalizeActive should find it
  const count = api.finalizeActive(state, {}, () => 2000, win, () => {})
  assert.equal(count, 1, 'expected the persisted active timer to be finalized post-view-switch')
  assert.equal(state.runtimeAgentCallTimersByNode.get('intent-agent').elapsedMs, 1000)
})

// --- error-event regression ---

test('finalizeActive on nextv_error stops running timers (timeout regression)', () => {
  // Regression guard: when nextv_error is received, finalizeNextVGraphActiveAgentTimers()
  // must be called to stop any running agent-call timers. This test ensures the
  // finalization logic correctly handles the error path.
  const api = loadTimerApi()
  const state = makeState()
  const win = makeWin()

  const startMs = 0
  state.runtimeAgentCallTimersByNode.set('intent-agent', { active: true, startMs, elapsedMs: 0 })
  state.runtimeAgentTickerId = win.setInterval(() => {}, 120)

  // Simulate the nextv_error handler calling finalizeNextVGraphActiveAgentTimers()
  const count = api.finalizeActive(state, {}, () => 5000, win, () => {})

  assert.equal(count, 1, 'expected one timer finalized on error')
  assert.equal(state.runtimeAgentCallTimersByNode.get('intent-agent').active, false)
  assert.equal(state.runtimeAgentTickerId, null, 'expected ticker stopped after error finalization')
})
