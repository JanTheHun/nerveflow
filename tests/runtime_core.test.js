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
