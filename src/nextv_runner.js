import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { runNextVScriptFromFile } from './nextv_runtime.js'

function cloneState(state) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) return {}
  return JSON.parse(JSON.stringify(state))
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export class NextVEventRunner {
  constructor(options = {}) {
    if (!options.entrypointPath) {
      throw new Error('entrypointPath is required')
    }

    this.entrypointPath = String(options.entrypointPath)
    this.persistenceEnabled = options.persistence !== false
    this.statePath = resolve(String(options.statePath ?? resolve(dirname(this.entrypointPath), 'state.json')))
    this.state = cloneState(options.initialState)
    this.defaultRunOptions = options.runOptions ?? {}
    this.stopOnScriptStop = options.stopOnScriptStop === true
    this.haltOnError = options.haltOnError !== false
    this.onExecution = typeof options.onExecution === 'function' ? options.onExecution : null
    this.onError = typeof options.onError === 'function' ? options.onError : null
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : null
    this.outputHandlers = isPlainObject(options.outputHandlers) ? options.outputHandlers : {}
    this.runFn = typeof options.runFn === 'function' ? options.runFn : runNextVScriptFromFile
    this.emitInitOnStart = options.emitInitOnStart !== false
    this.initSignalType = String(options.initSignalType ?? 'init').trim() || 'init'
    this.initSignalValue = options.initSignalValue ?? null

    this.running = false
    this.busy = false
    this.queue = []
    this.waiters = []
    this.idleWaiters = []
    this.pendingEvents = 0
    this.executionCount = 0
    this.failedExecutionCount = 0
    this.lastExecution = null
    this.lastError = null
    this.initPending = this.emitInitOnStart
  }

  start(options = {}) {
    if (this.running) return
    this.running = true
    this.initPending = this.emitInitOnStart

    if (options.initialEvent !== undefined) {
      this.enqueue(options.initialEvent)
    }

    this._runLoop().catch((err) => {
      if (this.onError) {
        this.onError(err)
      }
      this.running = false
      this._notifyIdle()
    })
  }

  stop() {
    if (!this.running) return
    this.running = false
    this.pendingEvents = 0
    this.queue.length = 0
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter.resolve(null)
    }
    this._notifyIdle()
  }

  enqueue(event) {
    if (!this.running) return false
    this.pendingEvents += 1

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()
      waiter.resolve(event)
    } else {
      this.queue.push(event)
    }
    return true
  }

  async waitForIdle() {
    if (!this.busy && this.pendingEvents === 0) return

    await new Promise((resolve) => {
      this.idleWaiters.push(resolve)
    })
  }

  getSnapshot() {
    return {
      running: this.running,
      busy: this.busy,
      queueLength: this.queue.length,
      pendingEvents: this.pendingEvents,
      executionCount: this.executionCount,
      failedExecutionCount: this.failedExecutionCount,
      statePath: this.statePath,
      persistenceEnabled: this.persistenceEnabled,
      state: cloneState(this.state),
      lastExecution: this.lastExecution,
      lastError: this.lastError,
    }
  }

  _loadPersistedState() {
    if (!this.persistenceEnabled) return
    if (!existsSync(this.statePath)) return

    let parsed
    try {
      parsed = JSON.parse(readFileSync(this.statePath, 'utf8'))
    } catch (err) {
      throw new Error(`Failed to read persisted state from ${this.statePath}: ${err.message}`)
    }

    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Persisted state in ${this.statePath} must be a JSON object.`)
    }

    this.state = cloneState(parsed)
  }

  _savePersistedState() {
    if (!this.persistenceEnabled) return

    const dir = dirname(this.statePath)
    mkdirSync(dir, { recursive: true })
    try {
      writeFileSync(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8')
    } catch (err) {
      throw new Error(`Failed to write persisted state to ${this.statePath}: ${err.message}`)
    }
  }

  async _nextEvent() {
    if (this.queue.length > 0) {
      return this.queue.shift()
    }

    return await new Promise((resolve) => {
      this.waiters.push({ resolve })
    })
  }

  _notifyIdle() {
    if (this.busy || this.queue.length > 0) return
    while (this.idleWaiters.length > 0) {
      const resolve = this.idleWaiters.shift()
      resolve()
    }
  }

  _resolveOutputHandler(format) {
    const byFormat = this.outputHandlers[format]
    if (typeof byFormat === 'function') return byFormat

    if (format === 'console') {
      const textFallback = this.outputHandlers.text
      if (typeof textFallback === 'function') return textFallback
    }

    const defaultHandler = this.outputHandlers.default
    if (typeof defaultHandler === 'function') return defaultHandler
    return null
  }

  async _dispatchOutputEvent(runtimeEvent, triggerEvent) {
    if (!runtimeEvent || runtimeEvent.type !== 'output') return

    const format = String(runtimeEvent.format ?? 'text')
    const handler = this._resolveOutputHandler(format)
    if (!handler) return

    await handler({
      output: runtimeEvent,
      triggerEvent,
      snapshot: this.getSnapshot(),
    })
  }

  async _runLoop() {
    while (this.running) {
      const event = await this._nextEvent()
      if (!this.running || event === null) break

      this.busy = true
      try {
        this._loadPersistedState()

        const executionEvents = []
        const shouldEmitInit = this.initPending
        this.initPending = false

        const result = await this.runFn(this.entrypointPath, {
          ...this.defaultRunOptions,
          state: this.state,
          event,
          autoInitSignalType: shouldEmitInit ? this.initSignalType : '',
          autoInitSignalValue: shouldEmitInit ? this.initSignalValue : null,
          onEvent: async (runtimeEvent) => {
            executionEvents.push(runtimeEvent)
            await this._dispatchOutputEvent(runtimeEvent, event)
            if (this.onEvent) {
              await this.onEvent({
                event,
                runtimeEvent,
                snapshot: this.getSnapshot(),
              })
            }
          },
        })

        this.state = cloneState(result.state)
        this._savePersistedState()
        this.executionCount += 1
        this.lastError = null
        this.lastExecution = {
          event,
          stopped: result.stopped === true,
          steps: result.steps,
        }

        if (this.onExecution) {
          this.onExecution({
            event,
            result,
            events: executionEvents.length > 0 ? executionEvents : (Array.isArray(result?.events) ? result.events : []),
            snapshot: this.getSnapshot(),
          })
        }

        if (this.stopOnScriptStop && result.stopped) {
          this.running = false
        }
      } catch (err) {
        this.failedExecutionCount += 1
        this.lastError = {
          message: String(err?.message ?? err ?? 'Unknown runner error'),
          line: Number.isFinite(Number(err?.line)) ? Number(err.line) : null,
          sourcePath: String(err?.sourcePath ?? ''),
          sourceLine: Number.isFinite(Number(err?.sourceLine)) ? Number(err.sourceLine) : null,
          kind: String(err?.kind ?? ''),
          code: String(err?.code ?? ''),
          statement: String(err?.statement ?? ''),
          event,
        }
        if (this.onError) {
          this.onError(err)
        }
        if (this.haltOnError) {
          this.running = false
        }
      } finally {
        this.pendingEvents = Math.max(0, this.pendingEvents - 1)
        this.busy = false
        this._notifyIdle()
      }
    }

    this.running = false
    this._notifyIdle()
  }
}
