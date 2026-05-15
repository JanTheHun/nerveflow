// nextv_graph_timer_api.js
// Pure timer-logic helpers for the Nerve Studio graph agent-call timers.
// Extracted from app.js to allow unit testing without a DOM environment.
// app.js delegates to this module; the browser page loads it before app.js.
;(function (global) {
  'use strict'

  function getTimerSlots(timerState) {
    if (Array.isArray(timerState?.slots)) return timerState.slots
    if (timerState && typeof timerState === 'object') return [timerState]
    return []
  }

  function replaceTimerState(timerState, nextSlots) {
    if (Array.isArray(timerState?.slots)) {
      return {
        ...timerState,
        slots: nextSlots,
      }
    }
    return nextSlots[0] ?? { active: false, startMs: 0, elapsedMs: 0 }
  }

  /**
   * Syncs the recurring interval ticker based on whether any agent-call timer
   * in `state.runtimeAgentCallTimersByNode` is still active.
   *
   * Starts the interval (via win.setInterval) when at least one timer is active
   * and no interval is running. Stops it when no active timers remain.
   *
   * @param {object} state   - graph state object (runtimeAgentCallTimersByNode, runtimeAgentTickerId)
   * @param {object} win     - window-like object supplying setInterval / clearInterval
   * @param {Function} onUpdate - called on each tick (updates graph visuals)
   */
  function syncTicker(state, win, onUpdate) {
    let hasActiveAgentCalls = false
    for (const timerState of state.runtimeAgentCallTimersByNode.values()) {
      const slots = getTimerSlots(timerState)
      if (slots.some((slot) => slot?.active === true)) {
        hasActiveAgentCalls = true
        break
      }
    }

    if (hasActiveAgentCalls) {
      if (!state.runtimeAgentTickerId) {
        state.runtimeAgentTickerId = win.setInterval(function tick() {
          onUpdate()
          syncTicker(state, win, onUpdate)
        }, 120)
      }
      return
    }

    if (state.runtimeAgentTickerId) {
      win.clearInterval(state.runtimeAgentTickerId)
      state.runtimeAgentTickerId = null
    }
  }

  /**
   * Finalizes all currently-active agent-call timers: marks them inactive and
   * records their elapsed time.  An optional `options.elapsedMs` override
   * enforces a minimum elapsed duration (useful when a result already carries
   * the authoritative elapsed time).
   *
   * Calls syncTicker and onUpdate if any timers were changed.
   *
   * @param {object}   state   - graph state object
   * @param {object}   options - { elapsedMs?: number } optional override
   * @param {Function} nowFn   - returns current timestamp in ms (injectable for tests)
   * @param {object}   win     - window-like object supplying setInterval / clearInterval
   * @param {Function} onUpdate - called after finalization to refresh graph visuals
   * @returns {number} count of timers that were finalized
   */
  function finalizeActive(state, options, nowFn, win, onUpdate) {
    const nowMs = nowFn()
    const elapsedOverrideMs = Number(options?.elapsedMs)
    const hasElapsedOverride = Number.isFinite(elapsedOverrideMs) && elapsedOverrideMs >= 0
    let changed = false
    let finalizedCount = 0

    for (const [nodeName, timerState] of state.runtimeAgentCallTimersByNode.entries()) {
      const slots = getTimerSlots(timerState)
      let nodeChanged = false
      const nextSlots = slots.map((slot) => {
        if (slot?.active !== true) return slot

        const startMs = Number(slot?.startMs)
        const computedElapsedMs = Math.max(0, nowMs - (Number.isFinite(startMs) ? startMs : nowMs))
        const elapsedMs = hasElapsedOverride
          ? Math.max(computedElapsedMs, elapsedOverrideMs)
          : computedElapsedMs

        nodeChanged = true
        finalizedCount += 1
        return {
          active: false,
          startMs: Number.isFinite(startMs) ? startMs : Math.max(0, nowMs - elapsedMs),
          elapsedMs,
        }
      })

      if (!nodeChanged) continue

      state.runtimeAgentCallTimersByNode.set(nodeName, replaceTimerState(timerState, nextSlots))
      changed = true
    }

    if (changed) {
      syncTicker(state, win, onUpdate)
      onUpdate()
    }

    return finalizedCount
  }

  global.nextVGraphTimerApi = { syncTicker, finalizeActive }
})(typeof globalThis !== 'undefined' ? globalThis : this)
