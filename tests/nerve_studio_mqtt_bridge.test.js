/**
 * Unit tests for nerve-studio MQTT remote observability bridge.
 *
 * Uses a mock MQTT client (EventEmitter-based) so no real broker is needed.
 * Pattern mirrors mqtt_embedded_host.test.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

import { createMqttRemoteBridge } from '../nerve-studio/mqtt-remote-bridge.js'
import { createEventBus } from '../src/host_core/event_bus.js'

// --- Mock MQTT client factory ---

function createMockMqttClient() {
  const emitter = new EventEmitter()
  const subscriptions = []
  let ended = false

  emitter.subscribe = (topic, cb) => {
    subscriptions.push(topic)
    if (typeof cb === 'function') cb(null)
  }

  emitter.end = () => {
    ended = true
  }

  emitter._subscriptions = subscriptions
  emitter._isEnded = () => ended

  // Helper: simulate an incoming event message
  emitter.simulateEvent = (eventName, payload) => {
    const envelope = JSON.stringify({ eventName, payload, sessionId: 'test', sequence: 0, timestamp: new Date().toISOString() })
    emitter.emit('message', `nextv/event/${eventName}`, Buffer.from(envelope))
  }

  // Helper: simulate a raw (possibly malformed) message on a topic
  emitter.simulateRaw = (topic, rawString) => {
    emitter.emit('message', topic, Buffer.from(rawString))
  }

  return emitter
}

// --- Tests ---

test('[Bridge-1] MQTT event message is forwarded to eventBus with correct eventName and payload', () => {
  const eventBus = createEventBus()
  const mockClient = createMockMqttClient()

  const received = []
  eventBus.subscribe((name, payload) => {
    received.push({ name, payload })
  })

  createMqttRemoteBridge({
    brokerUrl: 'mqtt://localhost:1883',
    topicPrefix: 'nextv/event',
    eventBus,
    createClient: () => mockClient,
  })

  mockClient.simulateEvent('nextv_snapshot', { state: { counter: 1 } })
  mockClient.simulateEvent('nextv_step', { sequenceNumber: 42 })

  assert.equal(received.length, 2)
  assert.equal(received[0].name, 'nextv_snapshot')
  assert.deepEqual(received[0].payload, { state: { counter: 1 } })
  assert.equal(received[1].name, 'nextv_step')
  assert.deepEqual(received[1].payload, { sequenceNumber: 42 })
})

test('[Bridge-2] Malformed MQTT message does not throw or corrupt the bus', () => {
  const eventBus = createEventBus()
  const mockClient = createMockMqttClient()

  const received = []
  eventBus.subscribe((name, payload) => {
    received.push({ name, payload })
  })

  createMqttRemoteBridge({
    brokerUrl: 'mqtt://localhost:1883',
    eventBus,
    createClient: () => mockClient,
  })

  // Not JSON at all
  assert.doesNotThrow(() => mockClient.simulateRaw('nextv/event/foo', 'not-json'))

  // Valid JSON but missing eventName
  assert.doesNotThrow(() => mockClient.simulateRaw('nextv/event/foo', JSON.stringify({ payload: 123 })))

  // eventName is not a string
  assert.doesNotThrow(() => mockClient.simulateRaw('nextv/event/foo', JSON.stringify({ eventName: 42, payload: {} })))

  // Empty string eventName
  assert.doesNotThrow(() => mockClient.simulateRaw('nextv/event/foo', JSON.stringify({ eventName: '', payload: {} })))

  // None of the malformed messages should reach the bus
  assert.equal(received.length, 0)

  // But a valid message still works after the bad ones
  mockClient.simulateEvent('nextv_snapshot', { ok: true })
  assert.equal(received.length, 1)
  assert.equal(received[0].name, 'nextv_snapshot')
})

test('[Bridge-3] disconnect() calls client.end()', () => {
  const eventBus = createEventBus()
  const mockClient = createMockMqttClient()

  const bridge = createMqttRemoteBridge({
    brokerUrl: 'mqtt://localhost:1883',
    eventBus,
    createClient: () => mockClient,
  })

  assert.equal(mockClient._isEnded(), false)
  bridge.disconnect()
  assert.equal(mockClient._isEnded(), true)
})

test('[Bridge-4] Bridge subscribes to correct wildcard topic on connect', () => {
  const eventBus = createEventBus()
  const mockClient = createMockMqttClient()

  createMqttRemoteBridge({
    brokerUrl: 'mqtt://localhost:1883',
    topicPrefix: 'nextv/event',
    eventBus,
    createClient: () => mockClient,
  })

  // Simulate MQTT broker connect
  mockClient.emit('connect')

  assert.deepEqual(mockClient._subscriptions, ['nextv/event/#'])
})

test('[Bridge-4b] Bridge respects custom topicPrefix', () => {
  const eventBus = createEventBus()
  const mockClient = createMockMqttClient()

  createMqttRemoteBridge({
    brokerUrl: 'mqtt://localhost:1883',
    topicPrefix: 'custom/prefix',
    eventBus,
    createClient: () => mockClient,
  })

  mockClient.emit('connect')

  assert.deepEqual(mockClient._subscriptions, ['custom/prefix/#'])
})

test('[Bridge-5] createMqttRemoteBridge throws on missing brokerUrl', () => {
  const eventBus = createEventBus()
  assert.throws(
    () => createMqttRemoteBridge({ brokerUrl: '', eventBus, createClient: () => new EventEmitter() }),
    /brokerUrl is required/,
  )
})

test('[Bridge-6] createMqttRemoteBridge throws on missing eventBus', () => {
  assert.throws(
    () => createMqttRemoteBridge({ brokerUrl: 'mqtt://localhost:1883', createClient: () => new EventEmitter() }),
    /eventBus with publish\(\) is required/,
  )
})
