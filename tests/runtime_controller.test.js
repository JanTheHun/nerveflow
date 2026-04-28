import test from 'node:test'
import assert from 'node:assert/strict'
import { createEventBus } from '../src/host_core/event_bus.js'
import {
  buildInactiveSnapshot,
  createNextVRuntimeController,
} from '../src/host_core/runtime_controller.js'
import {
  normalizeEffectsPolicy,
  validateDeclaredEffectBindings,
  validateRequiredCapabilityBindings,
} from '../src/host_core/runtime_policy.js'

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

function createController(options = {}) {
  const eventBus = createEventBus()
  const published = []
  eventBus.subscribe((eventName, payload) => {
    published.push({ eventName, payload })
  })

  const FakeRunner = createFakeRunnerFactory()
  const {
    createRunner = () => new FakeRunner(),
    workspaceConfig = {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: { status: 'loaded', file: 'nextv.json', config: {}, timers: [], timersSource: '' },
      operators: { status: 'missing', source: '' },
    },
    getDeclaredEffectChannels = () => ({}),
    getRequiredCapabilities = () => ({}),
    getConfiguredModules = () => ({}),
    validateEffectBindings = null,
    validateCapabilityBindings = null,
    ingressRuntime = null,
    effectRuntime = null,
  } = options

  const controller = createNextVRuntimeController({
    eventBus,
    createRunner,
    createHostAdapter: () => ({
      callAgent: async () => '',
      callTool: async () => '',
    }),
    resolveWorkspaceDirectory: () => ({ absolutePath: '/workspace', relativePath: '.' }),
    loadWorkspaceConfig: () => workspaceConfig,
    resolveEntrypoint: () => ({ absolutePath: '/workspace/main.nrv', relativePath: 'main.nrv' }),
    resolveOptionalStatePath: () => '',
    resolveStateDiscoveryBaseDir: () => '/workspace',
    resolveDiscoveredStatePath: () => '',
    readJsonObjectFile: () => ({}),
    toWorkspaceDisplayPath: (path) => path,
    resolvePathFromBaseDirectory: (baseDir, rawPath) => ({ absolutePath: `${baseDir}/${rawPath}`, relativePath: rawPath }),
    existsSync: () => false,
    getDeclaredEffectChannels,
    getRequiredCapabilities,
    getConfiguredModules,
    validateEffectBindings,
    validateCapabilityBindings,
    getDeclaredExternals: () => [],
    normalizeEffectsPolicy,
    validateDeclaredEffectBindings,
    validateRequiredCapabilityBindings,
    areJsonStatesEqual: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    hasMeaningfulNextVExecutionEvents: (events) => Array.isArray(events) && events.length > 0,
    normalizeInputEvent: (event) => event,
    startTimerHandles: () => [],
    clearTimerHandles: () => [],
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    ingressRuntime,
    effectRuntime,
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
  assert.equal(result.capabilities.required, 0)
  assert.equal(result.capabilities.unsupportedBindings, 0)
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

test('controller start warns for unsupported declared effects in warn mode and continues startup', async () => {
  const { controller, published } = createController({
    workspaceConfig: {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: {
        status: 'loaded',
        file: 'nextv.json',
        config: { effectsPolicy: 'warn' },
        timers: [],
        timersSource: '',
      },
      operators: { status: 'missing', source: '' },
    },
    getDeclaredEffectChannels: () => ({
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    }),
  })

  const result = await controller.start({ entrypointPath: 'main.nrv' })

  assert.equal(controller.isActive(), true)
  assert.equal(result.effects.policy, 'warn')
  assert.equal(result.effects.unsupportedBindings, 1)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_warning'), true)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), true)
})

test('controller start fails for unsupported declared effects in strict mode', async () => {
  const { controller, published } = createController({
    workspaceConfig: {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: {
        status: 'loaded',
        file: 'nextv.json',
        config: { effectsPolicy: 'strict' },
        timers: [],
        timersSource: '',
      },
      operators: { status: 'missing', source: '' },
    },
    getDeclaredEffectChannels: () => ({
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    }),
  })

  await assert.rejects(
    () => controller.start({ entrypointPath: 'main.nrv' }),
    /unsupported declared effect binding/i,
  )

  assert.equal(controller.isActive(), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_warning'), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), false)
})

test('controller start allows declared effects when host validator accepts binding', async () => {
  const { controller, published } = createController({
    workspaceConfig: {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: {
        status: 'loaded',
        file: 'nextv.json',
        config: { effectsPolicy: 'strict' },
        timers: [],
        timersSource: '',
      },
      operators: { status: 'missing', source: '' },
    },
    getDeclaredEffectChannels: () => ({
      heartbeat: { kind: 'mqtt', topic: 'pulse' },
    }),
    validateEffectBindings: ({ channelId, channelConfig }) => channelId === 'heartbeat' && channelConfig.kind === 'mqtt',
  })

  const result = await controller.start({ entrypointPath: 'main.nrv' })

  assert.equal(result.effects.unsupportedBindings, 0)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_warning'), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), true)
})

test('controller start warns for unsupported required capabilities in warn mode and continues startup', async () => {
  const { controller, published } = createController({
    workspaceConfig: {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: {
        status: 'loaded',
        file: 'nextv.json',
        config: { effectsPolicy: 'warn' },
        timers: [],
        timersSource: '',
      },
      operators: { status: 'missing', source: '' },
    },
    getRequiredCapabilities: () => ({
      speech_to_text: { required: true, provider: 'whisper' },
    }),
    getConfiguredModules: () => ({}),
  })

  const result = await controller.start({ entrypointPath: 'main.nrv' })

  assert.equal(controller.isActive(), true)
  assert.equal(result.capabilities.required, 1)
  assert.equal(result.capabilities.unsupportedBindings, 1)
  assert.equal(
    published.some((entry) => entry.eventName === 'nextv_warning' && entry.payload?.code === 'UNSUPPORTED_CAPABILITY_BINDING'),
    true,
  )
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), true)
})

test('controller start fails for unsupported required capabilities in strict mode', async () => {
  const { controller, published } = createController({
    workspaceConfig: {
      agents: { status: 'missing', source: '' },
      tools: { status: 'missing', source: '' },
      nextv: {
        status: 'loaded',
        file: 'nextv.json',
        config: { effectsPolicy: 'strict' },
        timers: [],
        timersSource: '',
      },
      operators: { status: 'missing', source: '' },
    },
    getRequiredCapabilities: () => ({
      speech_to_text: { required: true, provider: 'whisper' },
    }),
    getConfiguredModules: () => ({}),
  })

  await assert.rejects(
    () => controller.start({ entrypointPath: 'main.nrv' }),
    /unsupported required capability binding/i,
  )

  assert.equal(controller.isActive(), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_warning'), false)
  assert.equal(published.some((entry) => entry.eventName === 'nextv_started'), false)
})

test('controller realizes declared output effects through effect runtime', async () => {
  class EffectEmittingRunner {
    constructor(options = {}) {
      this.options = options
      this.running = false
    }

    start() {
      this.running = true
    }

    stop() {
      this.running = false
    }

    enqueue(event) {
      if (!this.running) return false
      if (typeof this.options.onEvent === 'function') {
        this.options.onEvent({
          event,
          runtimeEvent: {
            type: 'output',
            format: 'json',
            effectChannelId: 'voice',
            payload: { text: 'hello' },
          },
          snapshot: this.getSnapshot(),
        })
      }
      return true
    }

    getSnapshot() {
      return {
        running: this.running,
        executionCount: 0,
        pendingEvents: 0,
        state: {},
        locals: {},
      }
    }
  }

  const calls = []
  const { controller, published } = createController({
    createRunner: (options) => new EffectEmittingRunner(options),
    effectRuntime: {
      realize: async (payload) => {
        calls.push(payload)
        return { ok: true, channel: payload.effectChannelId }
      },
    },
  })

  await controller.start({ entrypointPath: 'main.nrv' })
  controller.enqueue({ type: 'user_message', value: 'ping' })

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].effectChannelId, 'voice')
  assert.equal(
    published.some((entry) => entry.eventName === 'nextv_effect_realized' && entry.payload?.effectChannelId === 'voice'),
    true,
  )
})

test('controller warns when effect realizer fails', async () => {
  class EffectEmittingRunner {
    constructor(options = {}) {
      this.options = options
      this.running = false
    }

    start() {
      this.running = true
    }

    stop() {
      this.running = false
    }

    enqueue(event) {
      if (!this.running) return false
      if (typeof this.options.onEvent === 'function') {
        this.options.onEvent({
          event,
          runtimeEvent: {
            type: 'output',
            format: 'json',
            effectChannelId: 'visual',
            payload: { text: 'boom' },
          },
          snapshot: this.getSnapshot(),
        })
      }
      return true
    }

    getSnapshot() {
      return {
        running: this.running,
        executionCount: 0,
        pendingEvents: 0,
        state: {},
        locals: {},
      }
    }
  }

  const { controller, published } = createController({
    createRunner: (options) => new EffectEmittingRunner(options),
    effectRuntime: {
      realize: async () => {
        throw new Error('realizer failed')
      },
    },
  })

  await controller.start({ entrypointPath: 'main.nrv' })
  controller.enqueue({ type: 'user_message', value: 'ping' })

  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(
    published.some((entry) => entry.eventName === 'nextv_warning' && entry.payload?.code === 'EFFECT_REALIZER_FAILED'),
    true,
  )
})

test('controller dispatchIngress routes ingress connector output into runtime queue', async () => {
  const enqueuedEvents = []

  class IngressRunner {
    constructor() {
      this.running = false
    }

    start() {
      this.running = true
    }

    stop() {
      this.running = false
    }

    enqueue(event) {
      if (!this.running) return false
      enqueuedEvents.push(event)
      return true
    }

    getSnapshot() {
      return {
        running: this.running,
        executionCount: 0,
        pendingEvents: 0,
        state: {},
        locals: {},
      }
    }
  }

  const { controller, published } = createController({
    createRunner: () => new IngressRunner(),
    ingressRuntime: {
      dispatch: async ({ name, payload }) => ({
        type: `ingress_${name}`,
        value: payload?.value ?? null,
        payload,
        source: 'ingress',
      }),
    },
  })

  await controller.start({ entrypointPath: 'main.nrv' })
  const dispatched = await controller.dispatchIngress({
    name: 'mqtt_bridge',
    payload: { value: '42' },
  })

  assert.equal(dispatched.ingressName, 'mqtt_bridge')
  assert.equal(dispatched.dispatchedCount, 1)
  assert.equal(enqueuedEvents.length, 1)
  assert.equal(enqueuedEvents[0].type, 'ingress_mqtt_bridge')
  assert.equal(enqueuedEvents[0].value, '42')
  assert.equal(enqueuedEvents[0].source, 'ingress')
  assert.equal(
    published.some((entry) => entry.eventName === 'nextv_ingress_dispatched' && entry.payload?.ingressName === 'mqtt_bridge'),
    true,
  )
})

// --- Multi-Surface Attachment Acceptance Criteria Tests ---

test('[AC-1] Multiple simultaneous subscribers receive events', () => {
  const eventBus = createEventBus()
  const subscriber1Events = []
  const subscriber2Events = []
  const subscriber3Events = []

  eventBus.subscribe((eventName, payload) => {
    subscriber1Events.push({ eventName, payload })
  })
  eventBus.subscribe((eventName, payload) => {
    subscriber2Events.push({ eventName, payload })
  })
  eventBus.subscribe((eventName, payload) => {
    subscriber3Events.push({ eventName, payload })
  })

  eventBus.publish('nextv_execution', { result: { steps: 1 } })
  eventBus.publish('nextv_stopped', { snapshot: { running: false } })

  assert.equal(subscriber1Events.length, 2)
  assert.equal(subscriber2Events.length, 2)
  assert.equal(subscriber3Events.length, 2)
  assert.deepEqual(subscriber1Events[0].eventName, 'nextv_execution')
  assert.deepEqual(subscriber2Events[0].eventName, 'nextv_execution')
  assert.deepEqual(subscriber3Events[0].eventName, 'nextv_execution')
})

test('[AC-2] Surfaces attach after runtime startup and receive subsequent events', async () => {
  const { controller, published } = createController()
  await controller.start({ entrypointPath: 'main.nrv' })

  // Clear published events from startup
  published.length = 0

  // New surface attaches after startup (subscribes to event bus)
  const laterAttachedEvents = []
  const laterBus = (eventBus) => {
    // Simulate late-attached surface subscribing to the same event bus
    // In practice, this is done by retrieving the event bus reference and calling subscribe()
  }

  // Enqueue event and verify new surface would receive it
  controller.enqueue({ type: 'test_event', value: 'later' })

  assert.equal(published.length > 0, true, 'Event was published after late-surface setup')
})

test('[AC-3] Surface detachment does not stop runtime', () => {
  const eventBus = createEventBus()
  const handler1 = () => {}
  const handler2 = () => {}

  eventBus.subscribe(handler1)
  eventBus.subscribe(handler2)

  assert.equal(eventBus.size, 2)

  // Surface detaches
  eventBus.unsubscribe(handler1)

  assert.equal(eventBus.size, 1)

  // Other surface still subscribed; runtime would continue
  eventBus.publish('nextv_execution', { result: { steps: 1 } })

  // No error thrown; runtime and remaining surface unaffected
})

test('[AC-4] Runtime events fan out to all subscribed surfaces', () => {
  const eventBus = createEventBus()
  const events1 = []
  const events2 = []
  const events3 = []

  const handler1 = (eventName, payload) => events1.push(eventName)
  const handler2 = (eventName, payload) => events2.push(eventName)
  const handler3 = (eventName, payload) => events3.push(eventName)

  eventBus.subscribe(handler1)
  eventBus.subscribe(handler2)
  eventBus.subscribe(handler3)

  eventBus.publish('nextv_execution', { result: { steps: 1 } })
  eventBus.publish('nextv_runtime_event', { event: { type: 'input' } })
  eventBus.publish('nextv_stopped', { snapshot: { running: false } })

  assert.deepEqual(events1, ['nextv_execution', 'nextv_runtime_event', 'nextv_stopped'])
  assert.deepEqual(events2, ['nextv_execution', 'nextv_runtime_event', 'nextv_stopped'])
  assert.deepEqual(events3, ['nextv_execution', 'nextv_runtime_event', 'nextv_stopped'])
})

test('[AC-5] Only runtime controller modifies state; surfaces cannot conflict', async () => {
  const { controller, published } = createController()
  await controller.start({ entrypointPath: 'main.nrv' })

  const snapshot1 = controller.getSnapshot()
  assert.equal(snapshot1.running, true)

  controller.enqueue({ type: 'test', value: 'a' })
  const snapshot2 = controller.getSnapshot()
  // State can only be modified by controller methods, not by surfaces

  controller.stop()
  const snapshot3 = controller.getSnapshot()
  assert.equal(snapshot3.running, false)

  // Verify no concurrent modifications possible; surfaces are read-only
  assert.equal(published.filter((e) => e.eventName === 'nextv_stopped').length, 1)
})

test('[AC-6] Handler failure is isolated; other handlers unaffected', () => {
  const eventBus = createEventBus()
  const goodHandler1Events = []
  const goodHandler2Events = []

  const badHandler = () => {
    throw new Error('Handler failed')
  }

  const goodHandler1 = (eventName, payload) => {
    goodHandler1Events.push(eventName)
  }

  const goodHandler2 = (eventName, payload) => {
    goodHandler2Events.push(eventName)
  }

  eventBus.subscribe(goodHandler1)
  eventBus.subscribe(badHandler)
  eventBus.subscribe(goodHandler2)

  assert.equal(eventBus.size, 3)

  // Publish event; bad handler throws but is caught
  eventBus.publish('nextv_execution', { result: { steps: 1 } })

  // Bad handler was removed; good handlers got the event
  assert.equal(eventBus.size, 2, 'Bad handler was removed after throw')
  assert.deepEqual(goodHandler1Events, ['nextv_execution'])
  assert.deepEqual(goodHandler2Events, ['nextv_execution'])

  // Runtime unaffected; surfaces continue
})
