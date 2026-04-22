import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventBus } from '../src/host_core/event_bus.js'
import {
  buildInactiveSnapshot,
  createNextVRuntimeController,
} from '../src/host_core/runtime_controller.js'

function createFakeRunnerFactory() {
  const state = {
    running: false,
    executionCount: 0,
    pendingEvents: 0,
    state: {},
    locals: {},
  }

  return class FakeRunner {
    constructor() {
      this.state = state
    }

    start() {
      this.state.running = true
    }

    stop() {
      this.state.running = false
    }

    enqueue() {
      if (!this.state.running) return false
      this.state.pendingEvents += 1
      return true
    }

    getSnapshot() {
      return {
        running: this.state.running,
        executionCount: this.state.executionCount,
        pendingEvents: this.state.pendingEvents,
        state: this.state.state,
        locals: this.state.locals,
      }
    }
  }
}

function createController() {
  const eventBus = createEventBus()
  const published = []
  eventBus.subscribe((eventName, payload) => {
    published.push({ eventName, payload })
  })

  const FakeRunner = createFakeRunnerFactory()

  const controller = createNextVRuntimeController({
    eventBus,
    createRunner: () => new FakeRunner(),
    createHostAdapter: () => ({
      callAgent: async () => '',
      callTool: async () => '',
    }),
    resolveWorkspaceDirectory: () => ({ absolutePath: '/workspace', relativePath: '.' }),
    loadWorkspaceConfig: () => ({
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: { status: 'loaded', file: 'nextv.json', config: {}, timers: [], timersSource: '' },
      operators: { status: 'missing', source: '' },
    }),
    resolveEntrypoint: () => ({ absolutePath: '/workspace/main.nrv', relativePath: 'main.nrv' }),
    resolveOptionalStatePath: () => '',
    resolveStateDiscoveryBaseDir: () => '/workspace',
    resolveDiscoveredStatePath: () => '',
    readJsonObjectFile: () => ({}),
    toWorkspaceDisplayPath: (path) => path,
    resolvePathFromBaseDirectory: (baseDir, rawPath) => ({ absolutePath: `${baseDir}/${rawPath}`, relativePath: rawPath }),
    existsSync: () => false,
    getDeclaredExternals: () => [],
    areJsonStatesEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    hasMeaningfulNextVExecutionEvents: (events) => Array.isArray(events) && events.length > 0,
    normalizeInputEvent: (event) => event,
    startTimerHandles: () => [],
    clearTimerHandles: () => [],
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    callAgent: async () => '',
    defaultModel: '',
  })

  return { controller, published }
}

test('buildInactiveSnapshot returns deterministic shape', () => {
  assert.deepEqual(buildInactiveSnapshot(), {
    running: false,
    executionCount: 0,
    pendingEvents: 0,
    state: {},
    locals: {},
  })
})

test('controller start publishes started event and activates runtime', async () => {
  const { controller, published } = createController()

  const result = await controller.start({ entrypointPath: 'main.nrv' })

  assert.equal(controller.isActive(), true)
  assert.equal(result.entrypointPath, 'main.nrv')
  assert.equal(result.trace.enabled, false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), true)
})

test('controller enqueue publishes queued event and snapshot while active', async () => {
  const { controller, published } = createController()
  await controller.start({ entrypointPath: 'main.nrv' })

  const queued = controller.enqueue({ type: 'user_message', value: 'hello' })

  assert.equal(queued.snapshot.running, true)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_event_queued'), true)
})

test('controller enqueue throws when runtime is inactive', () => {
  const { controller } = createController()

  assert.throws(
    () => controller.enqueue({ type: 'user_message' }),
    /nextV runtime not active/,
  )
})

test('controller stop publishes stopped event and deactivates runtime', async () => {
  const { controller, published } = createController()
  await controller.start({ entrypointPath: 'main.nrv' })

  const snapshot = controller.stop()

  assert.equal(snapshot.running, false)
  assert.equal(controller.isActive(), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_stopped'), true)
})
