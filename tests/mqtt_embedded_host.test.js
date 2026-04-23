/**
 * MQTT embedded host tests.
 *
 * Tests the createMqttHost factory directly with a mock MQTT client
 * (EventEmitter-based). No real broker or child process is needed,
 * which keeps tests fast and deterministic across platforms.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createMqttHost } from '../examples/mqtt-simple-host/create-mqtt-host.js'
import {
  loadWorkspaceNextVConfig,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
} from '../src/host_core/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(join(__dirname, '..'))

// --- Path resolvers (same workspace-relative contract as ws-simple-host) ---

function toWorkspaceDisplayPath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath
  return rel.replace(/\\/g, '/')
}

function readJsonObjectFile(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`JSON at ${toWorkspaceDisplayPath(filePath)} must be an object`)
  }
  return parsed
}

function resolveWorkspaceDirectory(inputPath) {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) {
    const rel = relative(REPO_ROOT, REPO_ROOT).replace(/\\/g, '/') || '.'
    return { absolutePath: REPO_ROOT, relativePath: rel }
  }
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')
  const absolutePath = resolve(REPO_ROOT, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
  if (!existsSync(absolutePath)) throw new Error(`Workspace directory not found: ${candidate.replace(/\\/g, '/')}`)
  return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
}

function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) throw new Error('filePath required')
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')
  const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
  const ext = extname(absolutePath).toLowerCase()
  if (kindRaw === 'script' && ext && ext !== '.nrv' && ext !== '.wfs') {
    throw new Error(`Unsupported extension '${ext}' for script`)
  }
  return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
}

function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
  const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
  const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
  if (!rawEntrypoint) throw new Error('entrypointPath required (or set nextv.json entrypointPath)')
  const joined = join(
    workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath,
    rawEntrypoint,
  )
  const entrypoint = resolvePathFromBaseDirectory(REPO_ROOT, joined.replace(/\\/g, '/'), 'script')
  if (!existsSync(entrypoint.absolutePath)) {
    throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
  }
  return entrypoint
}

const RESOLVERS = {
  resolveWorkspaceDirectory,
  loadWorkspaceConfig: (workspaceDir) =>
    loadWorkspaceNextVConfig({
      workspaceDir,
      toWorkspaceDisplayPath,
      resolvePathFromBaseDirectory,
      readJsonObjectFile,
    }),
  resolveEntrypoint,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  resolveDiscoveredStatePath,
  readJsonObjectFile,
  toWorkspaceDisplayPath,
  resolvePathFromBaseDirectory,
  existsSync,
}

// --- Mock MQTT client ---
// Minimal EventEmitter that records published messages.

function createMockMqttClient() {
  const emitter = new EventEmitter()
  const published = []

  emitter.published = published

  emitter.publish = (topic, payload, _opts, cb) => {
    let parsed
    try { parsed = JSON.parse(payload) } catch { parsed = payload }
    published.push({ topic, payload: parsed })
    if (typeof cb === 'function') cb(null)
  }

  // Simulate subscribe success (no-op; command routing is driven by emitter.emit('message'))
  emitter.subscribe = (_topic, cb) => {
    if (typeof cb === 'function') cb(null)
  }

  emitter.end = () => {}

  // Helper: simulate an incoming command message
  emitter.simulateCommand = (commandObj) => {
    emitter.emit('message', 'nextv/command', Buffer.from(JSON.stringify(commandObj)))
  }

  // Helper: wait for a published message matching predicate
  emitter.waitForPublished = (predicate, timeoutMs = 3000) =>
    new Promise((resolve, reject) => {
      // Check already-collected messages first
      const existing = published.find((m) => predicate(m.topic, m.payload))
      if (existing) return resolve(existing)

      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error('Timed out waiting for published MQTT message'))
      }, timeoutMs)

      const orig = emitter.publish.bind(emitter)
      emitter.publish = (topic, payload, opts, cb) => {
        orig(topic, payload, opts, cb)
        const last = published[published.length - 1]
        if (!settled && predicate(last.topic, last.payload)) {
          settled = true
          clearTimeout(timer)
          resolve(last)
        }
      }
    })

  return emitter
}

// --- Tests ---

test('mqtt-simple-host responds to snapshot command', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS, { sessionId: 'test-session' })

  try {
    const responsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/snap-1' && msg?.requestId === 'snap-1',
    )

    mockClient.simulateCommand({ type: 'snapshot', requestId: 'snap-1' })

    const { payload } = await responsePromise

    assert.equal(payload.ok, true)
    assert.equal(typeof payload.data?.snapshot, 'object')
    assert.equal(typeof payload.data?.running, 'boolean')
    assert.equal(payload.sessionId, 'test-session')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host returns validation_error for invalid JSON command', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    const responsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response' && msg?.ok === false,
    )

    // Emit raw non-JSON bytes
    mockClient.emit('message', 'nextv/command', Buffer.from('not valid json {{{'))

    const { payload } = await responsePromise

    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'validation_error')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host returns validation_error for unknown command type', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    const responsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/bad-1' && msg?.ok === false,
    )

    mockClient.simulateCommand({ type: 'unknown_command', requestId: 'bad-1' })

    const { payload } = await responsePromise

    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'validation_error')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host start command emits nextv_started event and returns ok', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    const startedEventPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_started',
    )
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/start-1' && msg?.requestId === 'start-1',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'start-1',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })

    const { payload: startResponse } = await startResponsePromise
    assert.equal(startResponse.ok, true)

    const { payload: startedEvent } = await startedEventPromise
    assert.equal(startedEvent.eventName, 'nextv_started')
    assert.equal(typeof startedEvent.payload?.snapshot, 'object')
    assert.equal(typeof startedEvent.sequence, 'number')
    assert.equal(startedEvent.sessionId.startsWith('mqtt-'), true)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host returns workspace-not-found error for typoed workspace path', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    const responsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/start-missing-workspace' && msg?.requestId === 'start-missing-workspace',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'start-missing-workspace',
      payload: { workspaceDir: 'nerve-studio/workspaces-local/chatbo' },
    })

    const { payload } = await responsePromise
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'validation_error')
    assert.equal(payload.error.message, 'Workspace directory not found: nerve-studio/workspaces-local/chatbo')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host enqueue_event emits nextv_execution event', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    // Start first
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/start-enq' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'start-enq',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })
    await startResponsePromise

    // Now enqueue an event
    const execEventPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_execution',
    )
    const enqResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/enq-1' && msg?.requestId === 'enq-1',
    )

    mockClient.simulateCommand({
      type: 'enqueue_event',
      requestId: 'enq-1',
      payload: { type: 'sensor_reading', value: '42.5' },
    })

    const { payload: enqResponse } = await enqResponsePromise
    assert.equal(enqResponse.ok, true)

    const { payload: execEvent } = await execEventPromise
    assert.equal(execEvent.eventName, 'nextv_execution')
    assert.equal(typeof execEvent.payload?.snapshot, 'object')
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host stop command emits nextv_stopped event', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    // Start first
    await new Promise((resolve) => {
      mockClient.waitForPublished(
        (topic, msg) => topic === 'nextv/response/start-stop' && msg?.ok === true,
      ).then(resolve)
      mockClient.simulateCommand({
        type: 'start',
        requestId: 'start-stop',
        payload: { workspaceDir: 'examples/mqtt-simple-host' },
      })
    })

    const stoppedEventPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_stopped',
    )
    const stopResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/stop-1' && msg?.requestId === 'stop-1',
    )

    mockClient.simulateCommand({ type: 'stop', requestId: 'stop-1' })

    const { payload: stopResponse } = await stopResponsePromise
    assert.equal(stopResponse.ok, true)

    const { payload: stoppedEvent } = await stoppedEventPromise
    assert.equal(stoppedEvent.eventName, 'nextv_stopped')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host returns not_active when stop called without active runtime', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    const responsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/stop-inactive',
    )

    mockClient.simulateCommand({ type: 'stop', requestId: 'stop-inactive' })

    const { payload } = await responsePromise
    assert.equal(payload.ok, false)
    assert.equal(payload.error.code, 'not_active')
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host event envelopes carry monotonic sequence numbers', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  // Collect all event-topic publishes
  const events = []
  const origPublish = mockClient.publish.bind(mockClient)
  mockClient.publish = (topic, payload, opts, cb) => {
    origPublish(topic, payload, opts, cb)
    if (topic.startsWith('nextv/event/')) {
      const last = mockClient.published[mockClient.published.length - 1]
      events.push(last.payload)
    }
  }

  try {
    // Start → emit nextv_started
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/seq-start' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'seq-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })
    await startResponsePromise

    // Stop → emit nextv_stopped
    const stopResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/seq-stop' && msg?.ok === true,
    )
    mockClient.simulateCommand({ type: 'stop', requestId: 'seq-stop' })
    await stopResponsePromise

    assert.ok(events.length >= 2, 'expected at least nextv_started and nextv_stopped events')

    for (let i = 1; i < events.length; i++) {
      assert.ok(
        events[i].sequence > events[i - 1].sequence,
        `sequence ${events[i].sequence} must be > ${events[i - 1].sequence}`,
      )
    }
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host event type include filter suppresses excluded events', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS, {
    // Only allow lifecycle events; suppress nextv_event_queued and nextv_runtime_event
    includeEvents: new Set(['nextv_started', 'nextv_stopped', 'nextv_error']),
  })

  try {
    // Start and wait for the start response
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/filter-start' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'filter-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })
    const { payload: startResponse } = await startResponsePromise
    assert.equal(startResponse.ok, true)

    // nextv_started must be present
    const startedMsg = mockClient.published.find(
      (m) => m.topic === 'nextv/event/nextv_started',
    )
    assert.ok(startedMsg, 'nextv_started should be published')

    // nextv_event_queued must NOT be present
    const queuedMsg = mockClient.published.find(
      (m) => m.topic === 'nextv/event/nextv_event_queued',
    )
    assert.equal(queuedMsg, undefined, 'nextv_event_queued should be suppressed by include filter')
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host custom predicate hook can suppress events', async () => {
  let predicateCalls = 0
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS, {
    // Suppress everything except nextv_started via custom predicate
    eventPredicate: (eventName) => {
      predicateCalls++
      return eventName === 'nextv_started'
    },
  })

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/pred-start' && msg?.ok === true,
    )
    const startedEventPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_started',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'pred-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })

    await startResponsePromise
    await startedEventPromise

    // Predicate must have been called at least once
    assert.ok(predicateCalls > 0, 'custom predicate should have been called')

    // nextv_event_queued must not be published (predicate returns false for it)
    const queuedMsg = mockClient.published.find(
      (m) => m.topic === 'nextv/event/nextv_event_queued',
    )
    assert.equal(queuedMsg, undefined, 'custom predicate should suppress nextv_event_queued')
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host routes chatbot agent calls through injected transport', async () => {
  const mockClient = createMockMqttClient()
  const observedCalls = []
  let resolveFirstAgentCall
  const firstAgentCall = new Promise((resolve) => {
    resolveFirstAgentCall = resolve
  })
  const host = createMqttHost(mockClient, RESOLVERS, {
    callAgent: async ({ model, messages }) => {
      observedCalls.push({ model, messages })
      resolveFirstAgentCall?.()
      return 'Hello from injected transport'
    },
  })

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/chat-start' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'chat-start',
      payload: { workspaceDir: 'nerve-studio/workspaces-local/chatbot' },
    })
    await startResponsePromise

    const enqueueResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/chat-msg-1' && msg?.ok === true,
    )

    mockClient.simulateCommand({
      type: 'enqueue_event',
      requestId: 'chat-msg-1',
      payload: { eventType: 'user_message', value: 'hello host' },
    })

    await enqueueResponsePromise
    await Promise.race([
      firstAgentCall,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timed out waiting for agent transport call')), 3000)
      }),
    ])

    assert.equal(observedCalls.length > 0, true)
    assert.equal(observedCalls[0].model, 'cogito:3b')
    assert.equal(Array.isArray(observedCalls[0].messages), true)
    const hasUserContent = observedCalls[0].messages.some(
      (m) => m?.role === 'user' && String(m?.content ?? '').includes('hello host'),
    )
    assert.equal(hasUserContent, true)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host publishes nextv_error when injected agent transport fails', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS, {
    callAgent: async () => {
      throw new Error('simulated transport failure')
    },
  })

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/chat-fail-start' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'chat-fail-start',
      payload: { workspaceDir: 'nerve-studio/workspaces-local/chatbot' },
    })
    await startResponsePromise

    const enqueueResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/chat-fail-msg' && msg?.ok === true,
    )
    const runtimeErrorPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_error',
      6000,
    )

    mockClient.simulateCommand({
      type: 'enqueue_event',
      requestId: 'chat-fail-msg',
      payload: { eventType: 'user_message', value: 'trigger failure' },
    })

    await enqueueResponsePromise
    const { payload } = await runtimeErrorPromise
    assert.equal(payload.eventName, 'nextv_error')
    assert.equal(
      String(payload?.payload?.message ?? '').includes('simulated transport failure'),
      true,
    )
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host suppresses timer-sourced events by default', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS, {
    callAgent: async () => 'ok',
  })

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/timer-start' && msg?.ok === true,
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'timer-start',
      payload: { workspaceDir: 'nerve-studio/workspaces-local/chatbot' },
    })

    await startResponsePromise

    // Wait for at least one timer interval in chatbot workspace (1000ms) and
    // verify no timer pulse/runtime/execution events were projected.
    await new Promise((resolve) => setTimeout(resolve, 1300))

    const hasTimerPulse = mockClient.published.some((m) => m.topic === 'nextv/event/nextv_timer_pulse')
    const hasTimerRuntimeEvent = mockClient.published.some(
      (m) => m.topic === 'nextv/event/nextv_runtime_event' && m.payload?.payload?.event?.source === 'timer',
    )
    const hasTimerExecutionEvent = mockClient.published.some(
      (m) => m.topic === 'nextv/event/nextv_execution' && m.payload?.payload?.event?.source === 'timer',
    )

    assert.equal(hasTimerPulse, false)
    assert.equal(hasTimerRuntimeEvent, false)
    assert.equal(hasTimerExecutionEvent, false)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host warns and starts when effectsPolicy is warn and binding is unsupported', async () => {
  const mockClient = createMockMqttClient()
  const resolvers = {
    ...RESOLVERS,
    loadWorkspaceConfig: (workspaceDir) => {
      const config = RESOLVERS.loadWorkspaceConfig(workspaceDir)
      return {
        ...config,
        nextv: {
          ...config.nextv,
          config: {
            ...config.nextv.config,
            effectsPolicy: 'warn',
          },
        },
        effects: {
          status: 'loaded',
          file: `${config.nextv.file}#effects`,
          source: `${config.nextv.file}#effects`,
          map: {
            heartbeat: { kind: 'serial', port: 'COM1', format: 'text' },
          },
        },
      }
    },
  }
  const host = createMqttHost(mockClient, resolvers)

  try {
    const warningPromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/event/nextv_warning' && msg?.eventName === 'nextv_warning',
    )
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/effects-warn-start' && msg?.requestId === 'effects-warn-start',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'effects-warn-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })

    const { payload: startResponse } = await startResponsePromise
    assert.equal(startResponse.ok, true)
    assert.equal(startResponse.data?.effects?.policy, 'warn')
    assert.equal(Number(startResponse.data?.effects?.unsupportedBindings ?? 0) > 0, true)

    const { payload: warningEvent } = await warningPromise
    assert.equal(warningEvent.payload?.code, 'UNSUPPORTED_EFFECT_BINDING')
    assert.equal(warningEvent.payload?.policy, 'warn')
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('mqtt-simple-host rejects startup in strict mode for unsupported effect kind', async () => {
  const mockClient = createMockMqttClient()
  const resolvers = {
    ...RESOLVERS,
    loadWorkspaceConfig: (workspaceDir) => {
      const config = RESOLVERS.loadWorkspaceConfig(workspaceDir)
      return {
        ...config,
        nextv: {
          ...config.nextv,
          config: {
            ...config.nextv.config,
            effectsPolicy: 'strict',
          },
        },
        effects: {
          status: 'loaded',
          file: `${config.nextv.file}#effects`,
          source: `${config.nextv.file}#effects`,
          map: {
            heartbeat: { kind: 'serial', port: 'COM1', format: 'text' },
          },
        },
      }
    },
  }
  const host = createMqttHost(mockClient, resolvers)

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/effects-strict-start' && msg?.requestId === 'effects-strict-start',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'effects-strict-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })

    const { payload: startResponse } = await startResponsePromise
    assert.equal(startResponse.ok, false)
    assert.equal(startResponse.error?.code, 'policy_denied')
    assert.equal(
      String(startResponse.error?.message ?? '').toLowerCase().includes('unsupported declared effect binding'),
      true,
    )

    const warningEvent = mockClient.published.find(
      (entry) => entry.topic === 'nextv/event/nextv_warning',
    )
    assert.equal(warningEvent, undefined)
  } finally {
    host.shutdown()
  }
})

test('mqtt-simple-host includeEvents can suppress nextv_warning while keeping startup success', async () => {
  const mockClient = createMockMqttClient()
  const resolvers = {
    ...RESOLVERS,
    loadWorkspaceConfig: (workspaceDir) => {
      const config = RESOLVERS.loadWorkspaceConfig(workspaceDir)
      return {
        ...config,
        nextv: {
          ...config.nextv,
          config: {
            ...config.nextv.config,
            effectsPolicy: 'warn',
          },
        },
        effects: {
          status: 'loaded',
          file: `${config.nextv.file}#effects`,
          source: `${config.nextv.file}#effects`,
          map: {
            heartbeat: { kind: 'serial', port: 'COM1', format: 'text' },
          },
        },
      }
    },
  }
  const host = createMqttHost(mockClient, resolvers, {
    includeEvents: new Set(['nextv_started', 'nextv_stopped', 'nextv_error']),
  })

  try {
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/effects-warn-filtered-start' && msg?.requestId === 'effects-warn-filtered-start',
    )

    mockClient.simulateCommand({
      type: 'start',
      requestId: 'effects-warn-filtered-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })

    const { payload: startResponse } = await startResponsePromise
    assert.equal(startResponse.ok, true)

    const startedEvent = mockClient.published.find((entry) => entry.topic === 'nextv/event/nextv_started')
    assert.ok(startedEvent, 'nextv_started should still be published')

    const warningEvent = mockClient.published.find((entry) => entry.topic === 'nextv/event/nextv_warning')
    assert.equal(warningEvent, undefined)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

// --- Multi-Surface Attachment Tests ---

test('[Multi-Surface] Multiple MQTT clients subscribe to same runtime', async () => {
  // Simulate two MQTT clients connecting to the same host
  const mockClient1 = createMockMqttClient()
  const mockClient2 = createMockMqttClient()
  
  // Both clients use the same runtime controller (in practice, shared via event bus subscription)
  const host = createMqttHost(mockClient1, RESOLVERS)

  try {
    // Client 1: Start runtime
    const startResponsePromise1 = mockClient1.waitForPublished(
      (topic, msg) => topic === 'nextv/response/multi-start' && msg?.ok === true,
    )
    mockClient1.simulateCommand({
      type: 'start',
      requestId: 'multi-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })
    await startResponsePromise1

    // Client 2: Subscribe to same event bus (simulate late attach)
    // In practice, this would be done by client 2 getting a reference to the same eventBus
    // For this test, we verify that both clients could subscribe to the host's event bus
    const client2EventsReceived = []
    host.eventBus.subscribe((eventName, payload) => {
      client2EventsReceived.push({ eventName, payload })
    })

    // Client 1: Enqueue event
    mockClient1.simulateCommand({
      type: 'enqueue_event',
      requestId: 'multi-enq',
      payload: { type: 'test', value: 'multi-surface' },
    })

    // Wait for execution event
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Both client 1 (via MQTT publish) and client 2 (via direct subscription) receive events
    const client1ReceivedExecution = mockClient1.published.some(
      (m) => m.topic === 'nextv/event/nextv_execution',
    )
    const client2ReceivedExecution = client2EventsReceived.some(
      (m) => m.eventName === 'nextv_execution',
    )

    assert.equal(client1ReceivedExecution, true)
    assert.equal(client2ReceivedExecution, true)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

test('[Multi-Surface] MQTT client disconnect does not stop runtime', async () => {
  const mockClient = createMockMqttClient()
  const host = createMqttHost(mockClient, RESOLVERS)

  try {
    // Start runtime
    const startResponsePromise = mockClient.waitForPublished(
      (topic, msg) => topic === 'nextv/response/detach-start' && msg?.ok === true,
    )
    mockClient.simulateCommand({
      type: 'start',
      requestId: 'detach-start',
      payload: { workspaceDir: 'examples/mqtt-simple-host' },
    })
    await startResponsePromise

    // Simulate MQTT client subscription and unsubscription
    const separateObserver = []
    const handler = (eventName, payload) => {
      separateObserver.push({ eventName, payload })
    }
    host.eventBus.subscribe(handler)

    // Unsubscribe (simulate client disconnect)
    host.eventBus.unsubscribe(handler)

    // Enqueue event and verify runtime continues
    const execEventPromise = mockClient.waitForPublished(
      (topic) => topic === 'nextv/event/nextv_execution',
    )
    mockClient.simulateCommand({
      type: 'enqueue_event',
      requestId: 'detach-enq',
      payload: { type: 'test', value: 'after-detach' },
    })

    const { payload } = await execEventPromise
    assert.equal(payload.eventName, 'nextv_execution')
    
    // Disconnected observer did not receive the event
    assert.equal(separateObserver.length, 0, 'Disconnected observer should not receive events')
    
    // But the original MQTT client still receives it (runtime continues)
    assert.equal(mockClient.published.length > 0, true)
  } finally {
    host.runtimeController.stop()
    host.shutdown()
  }
})

