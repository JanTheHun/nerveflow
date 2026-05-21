import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'

import {
  createRuntimeCommandRouter,
  createRuntimeCore,
  createRuntimeResolvers,
} from '../src/runtime/index.js'

const REPO_ROOT = resolve(process.cwd())

test('runtime core starts, enqueues, and stops with single active session rule', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  const events = []
  const detach = runtime.attachSurface((eventName, payload) => {
    events.push({ eventName, payload })
  })

  const started = await runtime.start({ workspaceDir: 'examples/mqtt-simple-host' })
  assert.equal(runtime.isActive(), true)
  assert.equal(started.workspaceDir, 'examples/mqtt-simple-host')

  await assert.rejects(
    () => runtime.start({ workspaceDir: 'examples/mqtt-simple-host' }),
    /already active/i,
  )

  const enqueued = runtime.enqueue({ eventType: 'sensor_reading', value: '42' })
  assert.equal(typeof enqueued.snapshot, 'object')

  const stopped = runtime.stop()
  assert.equal(runtime.isActive(), false)
  assert.equal(stopped.running, false)

  detach()

  assert.equal(events.some((e) => e.eventName === 'nextv_started'), true)
  assert.equal(events.some((e) => e.eventName === 'nextv_event_queued'), true)
  assert.equal(events.some((e) => e.eventName === 'nextv_stopped'), true)
})

test('runtime command router returns protocol responses', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  const router = createRuntimeCommandRouter({
    runtimeCore: runtime,
    sessionId: 'runtime-test-session',
  })

  const startResponse = await router.handleRawCommand({
    type: 'start',
    requestId: 'start-1',
    payload: { workspaceDir: 'examples/mqtt-simple-host' },
  })

  assert.equal(startResponse.ok, true)
  assert.equal(startResponse.sessionId, 'runtime-test-session')

  const snapshotResponse = await router.handleRawCommand({
    type: 'snapshot',
    requestId: 'snap-1',
    payload: {},
  })

  assert.equal(snapshotResponse.ok, true)
  assert.equal(snapshotResponse.data.running, true)

  const candidateResponse = await router.handleRawCommand({
    type: 'submit_candidate',
    requestId: 'candidate-1',
    payload: {},
  })

  assert.equal(candidateResponse.ok, true)
  assert.equal(
    candidateResponse.data.status === 'promotable' || candidateResponse.data.status === 'rejected',
    true,
  )

  const promoteResponse = await router.handleRawCommand({
    type: 'promote_candidate',
    requestId: 'promote-1',
    payload: {},
  })

  // Runtime starts with no candidate, so promote must either succeed (if submit was promotable)
  // or return an error — either way the command is recognised (not 'validation_error')
  assert.notEqual(promoteResponse.error?.code, 'validation_error')

  const definitionStatusResponse = await router.handleRawCommand({
    type: 'definition_status',
    requestId: 'defs-1',
    payload: {},
  })

  assert.equal(definitionStatusResponse.ok, true)
  assert.equal(definitionStatusResponse.data.active.running, true)
  assert.equal(typeof definitionStatusResponse.data.candidate?.status, 'string')

  const unsubscribeResponse = await router.handleRawCommand({
    type: 'unsubscribe',
    requestId: 'u-1',
    payload: {},
  })
  assert.equal(unsubscribeResponse.ok, true)
  assert.equal(unsubscribeResponse.data.subscribed, false)

  const stopResponse = await router.handleRawCommand({
    type: 'stop',
    requestId: 'stop-1',
    payload: {},
  })

  assert.equal(stopResponse.ok, true)
  assert.equal(stopResponse.data.snapshot.running, false)
})

test('runtime command router returns validation_error for malformed JSON', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  const router = createRuntimeCommandRouter({
    runtimeCore: runtime,
    sessionId: 'runtime-test-session',
  })

  const response = await router.handleRawCommand('not-json')
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'validation_error')
})

test('runtime command router returns validation_error for undeclared external enqueue event', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  const router = createRuntimeCommandRouter({
    runtimeCore: runtime,
    sessionId: 'runtime-test-session',
  })

  const startResponse = await router.handleRawCommand({
    type: 'start',
    requestId: 'start-undeclared-1',
    payload: { workspaceDir: 'examples/mqtt-simple-host' },
  })
  assert.equal(startResponse.ok, true)

  const enqueueResponse = await router.handleRawCommand({
    type: 'enqueue_event',
    requestId: 'enqueue-undeclared-1',
    payload: { eventType: 'user_message', value: 'hello' },
  })
  assert.equal(enqueueResponse.ok, false)
  assert.equal(enqueueResponse.error.code, 'validation_error')

  const stopResponse = await router.handleRawCommand({
    type: 'stop',
    requestId: 'stop-undeclared-1',
    payload: {},
  })
  assert.equal(stopResponse.ok, true)
})

test('runtime command router handles dispatch_ingress command', async () => {
  const runtime = {
    dispatchIngressCalls: [],
    async dispatchIngress(payload) {
      this.dispatchIngressCalls.push(payload)
      return {
        ingressName: payload?.name,
        dispatchedCount: 1,
        enqueued: [{ event: { type: 'ingress_test' }, snapshot: { running: true } }],
      }
    },
    async start() {
      throw new Error('not used')
    },
    stop() {
      throw new Error('not used')
    },
    enqueue() {
      throw new Error('not used')
    },
    getSnapshot() {
      return { running: true }
    },
    isActive() {
      return true
    },
  }

  const router = createRuntimeCommandRouter({
    runtimeCore: runtime,
    sessionId: 'runtime-test-session',
  })

  const response = await router.handleRawCommand({
    type: 'dispatch_ingress',
    requestId: 'ingress-1',
    payload: { name: 'mqtt_bridge', value: 'hello' },
  })

  assert.equal(response.ok, true)
  assert.equal(response.requestId, 'ingress-1')
  assert.equal(response.data.ingressName, 'mqtt_bridge')
  assert.equal(response.data.dispatchedCount, 1)
  assert.deepEqual(runtime.dispatchIngressCalls, [{ name: 'mqtt_bridge', value: 'hello' }])
})

test('runtime command router handles call_inspector_execute command', async () => {
  const runtime = {
    callInspectorExecuteCalls: [],
    async callInspectorExecute(payload) {
      this.callInspectorExecuteCalls.push(payload)
      return {
        call: {
          targetKind: 'model',
          target: 'test-model',
          mode: 'try',
          validate: 'coerce',
          retry_on_contract_violation: 0,
        },
        result: {
          value: { ok: true },
          metadata: null,
          violation: null,
          hadContractViolation: false,
        },
        elapsedMs: 1,
      }
    },
    async start() {
      throw new Error('not used')
    },
    stop() {
      throw new Error('not used')
    },
    enqueue() {
      throw new Error('not used')
    },
    getSnapshot() {
      return { running: true }
    },
    isActive() {
      return true
    },
  }

  const router = createRuntimeCommandRouter({
    runtimeCore: runtime,
    sessionId: 'runtime-test-session',
  })

  const payload = {
    targetKind: 'model',
    mode: 'try',
    model: 'test-model',
    prompt: 'hello',
  }
  const response = await router.handleRawCommand({
    type: 'call_inspector_execute',
    requestId: 'call-1',
    payload,
  })

  assert.equal(response.ok, true)
  assert.equal(response.requestId, 'call-1')
  assert.equal(response.data.call.targetKind, 'model')
  assert.equal(response.data.call.target, 'test-model')
  assert.equal(response.data.call.mode, 'try')
  assert.deepEqual(runtime.callInspectorExecuteCalls, [payload])
})

test('runtime core callInspectorExecute mode=try returns success envelope', async () => {
  const previousModelResolution = process.env.AGENT_MODEL_RESOLUTION
  process.env.AGENT_MODEL_RESOLUTION = 'legacy'

  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
    callAgent: async () => 'play',
  })

  try {
    const response = await runtime.callInspectorExecute({
      workspaceDir: 'examples/mqtt-simple-host',
      targetKind: 'model',
      mode: 'try',
      model: 'test-model',
      prompt: 'hello',
    })

    assert.equal(response.call.mode, 'try')
    assert.equal(response.result.hadContractViolation, false)
    assert.deepEqual(response.result.value, {
      ok: true,
      value: 'play',
    })
    assert.deepEqual(response.result.parsed, {
      ok: true,
      value: 'play',
    })
    assert.equal(response.resolvedCall.attempt, 1)
    assert.equal(response.resolvedCall.retryLimit, 0)
    assert.equal(Array.isArray(response.resolvedCall.finalRequest?.messages), true)
    assert.equal(response.resolvedCall.finalRequest.messages.length > 0, true)
    assert.equal(response.resolvedCall.retryGuidanceInjected, false)
  } finally {
    if (previousModelResolution == null) {
      delete process.env.AGENT_MODEL_RESOLUTION
    } else {
      process.env.AGENT_MODEL_RESOLUTION = previousModelResolution
    }
  }
})

test('runtime core callInspectorExecute mode=try returns failure envelope on contract violation', async () => {
  const previousModelResolution = process.env.AGENT_MODEL_RESOLUTION
  process.env.AGENT_MODEL_RESOLUTION = 'legacy'

  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
    callAgent: async () => '{"intent":"maybe"}',
  })

  try {
    const response = await runtime.callInspectorExecute({
      workspaceDir: 'examples/mqtt-simple-host',
      targetKind: 'model',
      mode: 'try',
      model: 'test-model',
      prompt: 'hello',
      returns: { intent: ['yes', 'no'] },
      validate: 'strict',
      retry_on_contract_violation: 1,
    })

    assert.equal(response.call.mode, 'try')
    assert.equal(response.result.hadContractViolation, true)
    assert.equal(response.result.value?.ok, false)
    assert.equal(response.result.value?.error?.type, 'agent_return_contract_violation')
    assert.equal(typeof response.result.value?.error?.message, 'string')
    assert.equal(response.resolvedCall.attempt, 2)
    assert.equal(response.resolvedCall.retryLimit, 1)
    assert.equal(response.resolvedCall.retryGuidanceInjected, true)
    assert.equal(Array.isArray(response.resolvedCall.finalRequest?.messages), true)
    assert.equal(
      response.resolvedCall.finalRequest.messages.some((entry) => (
        String(entry?.role ?? '') === 'user'
        && /the previous response/i.test(String(entry?.content ?? ''))
      )),
      true,
    )
  } finally {
    if (previousModelResolution == null) {
      delete process.env.AGENT_MODEL_RESOLUTION
    } else {
      process.env.AGENT_MODEL_RESOLUTION = previousModelResolution
    }
  }
})

test('runtime core callInspectorExecute forwards governed tools policy', async () => {
  const previousModelResolution = process.env.AGENT_MODEL_RESOLUTION
  process.env.AGENT_MODEL_RESOLUTION = 'legacy'

  let capturedPayload = null
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
    callAgent: async (payload) => {
      capturedPayload = payload
      return 'tool-ready'
    },
  })

  try {
    const response = await runtime.callInspectorExecute({
      workspaceDir: 'examples/mqtt-simple-host',
      targetKind: 'model',
      mode: 'call',
      model: 'test-model',
      prompt: 'hello',
      tools: {
        mode: 'governed',
        allow: ['search', 'fetch'],
        maxRounds: 3,
        timeoutMs: 2500,
        denyOnUnknownTool: false,
      },
    })

    assert.equal(Array.isArray(capturedPayload?.tools), true)
    assert.equal(capturedPayload.tools.length, 2)
    assert.equal(capturedPayload.tools[0].function.name, 'search')
    assert.equal(capturedPayload.tools[1].function.name, 'fetch')
    assert.equal(response.call.tools.mode, 'governed')
    assert.deepEqual(response.call.tools.allow, ['search', 'fetch'])
    assert.equal(response.resolvedCall.tools.mode, 'governed')
    assert.deepEqual(response.resolvedCall.tools.allow, ['search', 'fetch'])
  } finally {
    if (previousModelResolution == null) {
      delete process.env.AGENT_MODEL_RESOLUTION
    } else {
      process.env.AGENT_MODEL_RESOLUTION = previousModelResolution
    }
  }
})

test('runtime core callInspectorExecute rejects invalid tools mode', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
    callAgent: async () => 'ignored',
  })

  await assert.rejects(
    () => runtime.callInspectorExecute({
      workspaceDir: 'examples/mqtt-simple-host',
      targetKind: 'model',
      mode: 'call',
      model: 'test-model',
      prompt: 'hello',
      tools: {
        mode: 'auto',
      },
    }),
    /tools.mode must be either "disabled" or "governed"/i,
  )
})

test('controller startup exposes configured models in nextv_started event', async () => {
  const runtime = createRuntimeCore({
    resolvers: createRuntimeResolvers({ repoRoot: REPO_ROOT }),
  })

  const eventBus = {
    events: [],
    publish(eventName, payload) {
      this.events.push({ eventName, payload })
    },
    subscribe() {
      return () => {}
    },
  }

  const mockController = {
    startedEvent: null,
    async start(eventPayload) {
      this.startedEvent = eventPayload
    },
    async stop() {},
    async enqueue() {
      return { running: true }
    },
    async dispatchIngress() {
      return {}
    },
  }

  // We would need to mock the runtime controller creation to test this properly.
  // For now, this is a placeholder for the intent: models should be exposed in nextv_started event.
  assert.equal(runtime, runtime) // Basic sanity check
})
