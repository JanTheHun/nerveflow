import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  semanticSurfaceCapability,
} from '../src/host_core/index.js'

function makeEffectPayload(overrides = {}) {
  return {
    name: 'semantic_surface',
    event: {
      value: {
        schemaVersion: '1.0',
        capability: 'semantic-surface',
        effectName: 'semantic_surface',
        interactionId: 'confirm_delete_1',
        target: 'main',
        intent: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
        timestamp: '2026-05-29T12:00:00Z',
        runtimeEventId: 'evt_1',
      },
    },
    runtimeEvent: { id: 'evt_1' },
    ...overrides,
  }
}

function makeIngressPayload(overrides = {}) {
  return {
    schemaVersion: '1.0',
    eventType: 'semantic_surface_event',
    interactionId: 'confirm_delete_1',
    target: 'main',
    action: 'selected',
    value: { selected: 'yes' },
    timestamp: '2026-05-29T12:00:02Z',
    sourceSessionId: 'surface_main_1',
    ...overrides,
  }
}

test('semanticSurfaceCapability returns ingress/effect capability shape', () => {
  const capability = semanticSurfaceCapability()

  assert.equal(Array.isArray(capability.ingressConnectors), true)
  assert.equal(Array.isArray(capability.effectRealizers), true)
  assert.equal(typeof capability.setup, 'function')
  assert.equal(typeof capability.teardown, 'function')
  assert.equal(typeof capability.getPendingInteractions, 'function')
})

test('semantic-surface effect realizer validates envelope and returns lifecycle state', async () => {
  const capability = semanticSurfaceCapability()
  const realizer = capability.effectRealizers[0]

  const result = await realizer.semantic_surface(makeEffectPayload())

  assert.equal(result.ok, true)
  assert.equal(result.effectName, 'semantic_surface')
  assert.equal(result.interactionId, 'confirm_delete_1')
  assert.equal(result.lifecycleState, 'requested')

  const pending = capability.getPendingInteractions()
  assert.equal(pending.length, 1)
  assert.equal(pending[0].interactionId, 'confirm_delete_1')
})

test('semantic-surface effect realizer accepts runtimeEvent.value envelope shape', async () => {
  const capability = semanticSurfaceCapability()
  const realizer = capability.effectRealizers[0]

  const payload = makeEffectPayload({
    event: {},
    runtimeEvent: {
      id: 'evt_1',
      value: {
        schemaVersion: '1.0',
        capability: 'semantic-surface',
        effectName: 'semantic_surface',
        interactionId: 'confirm_delete_runtime_event',
        target: 'main',
        intent: {
          type: 'choice',
          options: [
            { id: 'yes', label: 'Yes' },
            { id: 'no', label: 'No' },
          ],
        },
        timestamp: '2026-05-29T12:00:00Z',
        runtimeEventId: 'evt_1',
      },
    },
  })

  const result = await realizer.semantic_surface(payload)
  assert.equal(result.ok, true)
  assert.equal(result.interactionId, 'confirm_delete_runtime_event')
})

test('semantic-surface effect realizer rejects missing interactionId', async () => {
  const capability = semanticSurfaceCapability()
  const realizer = capability.effectRealizers[0]

  await assert.rejects(
    () => realizer.semantic_surface(makeEffectPayload({
      event: {
        value: {
          schemaVersion: '1.0',
          effectName: 'semantic_surface',
          target: 'main',
          intent: { type: 'choice' },
          timestamp: '2026-05-29T12:00:00Z',
          runtimeEventId: 'evt_1',
        },
      },
    })),
    /requires interactionId/i,
  )
})

test('semantic-surface ingress connector validates envelope and normalizes runtime event', async () => {
  const capability = semanticSurfaceCapability()
  const connector = capability.ingressConnectors[0]

  const result = await connector.semantic_surface_event(makeIngressPayload())

  assert.equal(result.type, 'semantic_surface_event')
  assert.equal(result.source, 'external')
  assert.equal(result.value.interactionId, 'confirm_delete_1')
  assert.deepEqual(result.value.payload, { selected: 'yes' })
})

test('semantic-surface ingress connector rejects invalid eventType', async () => {
  const capability = semanticSurfaceCapability()
  const connector = capability.ingressConnectors[0]

  await assert.rejects(
    () => connector.semantic_surface_event(makeIngressPayload({
      eventType: 'button_clicked',
    })),
    /requires eventType semantic_surface_event/i,
  )
})

test('semantic-surface terminal ingress duplicates are ignored', async () => {
  const capability = semanticSurfaceCapability()
  const connector = capability.ingressConnectors[0]

  const first = await connector.semantic_surface_event(makeIngressPayload())
  const duplicate = await connector.semantic_surface_event(makeIngressPayload())

  assert.equal(first.type, 'semantic_surface_event')
  assert.deepEqual(duplicate, [])
})

test('semantic-surface setup/teardown clears pending interaction state', async () => {
  const capability = semanticSurfaceCapability()
  const realizer = capability.effectRealizers[0]

  await realizer.semantic_surface(makeEffectPayload())
  assert.equal(capability.getPendingInteractions().length, 1)

  await capability.setup()
  assert.equal(capability.getPendingInteractions().length, 0)

  await realizer.semantic_surface(makeEffectPayload())
  assert.equal(capability.getPendingInteractions().length, 1)

  await capability.teardown()
  assert.equal(capability.getPendingInteractions().length, 0)
})
