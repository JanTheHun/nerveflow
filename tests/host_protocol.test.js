import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_COMMAND_TYPES,
  HOST_ERROR_CODES,
  HOST_EVENT_NAMES,
  HOST_PROTOCOL_VERSION,
  buildHostProtocolEvent,
  buildHostProtocolResponse,
  normalizeHostProtocolError,
  validateHostProtocolCommand,
} from '../src/host_core/protocol.js'

test('validateHostProtocolCommand normalizes valid command envelope', () => {
  const result = validateHostProtocolCommand({
    type: 'start',
    requestId: 'req-1',
    sessionId: 'session-1',
    payload: { entrypointPath: 'main.nrv' },
    timestamp: '2026-04-22T00:00:00.000Z',
  })

  assert.equal(result.protocolVersion, HOST_PROTOCOL_VERSION)
  assert.equal(result.type, 'start')
  assert.equal(result.requestId, 'req-1')
  assert.equal(result.sessionId, 'session-1')
  assert.deepEqual(result.payload, { entrypointPath: 'main.nrv' })
  assert.equal(result.timestamp, '2026-04-22T00:00:00.000Z')
})

test('validateHostProtocolCommand rejects unknown commands by default', () => {
  assert.throws(
    () => validateHostProtocolCommand({ type: 'unknown_command' }),
    /command.type must be one of/,
  )
})

test('validateHostProtocolCommand can allow unknown commands', () => {
  const result = validateHostProtocolCommand(
    { type: 'future_command' },
    { allowUnknownCommands: true },
  )

  assert.equal(result.type, 'future_command')
})

test('normalizeHostProtocolError accepts known error codes', () => {
  const normalized = normalizeHostProtocolError({
    code: 'validation_error',
    message: 'Invalid payload',
    details: { field: 'payload' },
  })

  assert.deepEqual(normalized, {
    code: 'validation_error',
    message: 'Invalid payload',
    details: { field: 'payload' },
  })
})

test('normalizeHostProtocolError rejects unknown error codes', () => {
  assert.throws(
    () => normalizeHostProtocolError({ code: 'bad_code', message: 'x' }),
    /error.code must be one of/,
  )
})

test('buildHostProtocolResponse returns success envelope', () => {
  const response = buildHostProtocolResponse({
    requestId: 'req-42',
    ok: true,
    data: { running: false },
    timestamp: '2026-04-22T00:00:00.000Z',
  })

  assert.equal(response.protocolVersion, HOST_PROTOCOL_VERSION)
  assert.equal(response.requestId, 'req-42')
  assert.equal(response.ok, true)
  assert.deepEqual(response.data, { running: false })
})

test('buildHostProtocolResponse returns error envelope', () => {
  const response = buildHostProtocolResponse({
    requestId: 'req-43',
    ok: false,
    error: {
      code: 'runtime_error',
      message: 'Runner crashed',
    },
    timestamp: '2026-04-22T00:00:00.000Z',
  })

  assert.equal(response.ok, false)
  assert.deepEqual(response.error, {
    code: 'runtime_error',
    message: 'Runner crashed',
    details: undefined,
  })
})

test('buildHostProtocolResponse rejects conflicting success/error fields', () => {
  assert.throws(
    () => buildHostProtocolResponse({ ok: true, error: { code: 'runtime_error', message: 'x' } }),
    /response.error must be omitted when response.ok is true/,
  )

  assert.throws(
    () => buildHostProtocolResponse({ ok: false, data: { ok: true }, error: { code: 'runtime_error', message: 'x' } }),
    /response.data must be omitted when response.ok is false/,
  )
})

test('buildHostProtocolEvent validates known events and normalizes envelope', () => {
  const event = buildHostProtocolEvent({
    eventName: 'nextv_started',
    payload: { ok: true },
    sessionId: 'session-1',
    sequence: 7,
    timestamp: '2026-04-22T00:00:00.000Z',
  })

  assert.equal(event.protocolVersion, HOST_PROTOCOL_VERSION)
  assert.equal(event.eventName, 'nextv_started')
  assert.deepEqual(event.payload, { ok: true })
  assert.equal(event.sessionId, 'session-1')
  assert.equal(event.sequence, 7)
})

test('buildHostProtocolEvent rejects unknown events by default', () => {
  assert.throws(
    () => buildHostProtocolEvent({ eventName: 'future_event' }),
    /event.eventName must be one of/,
  )
})

test('protocol constants include required v1 values', () => {
  assert.equal(HOST_PROTOCOL_VERSION, '1.0')
  assert.deepEqual(HOST_COMMAND_TYPES, [
    'start',
    'stop',
    'enqueue_event',
    'snapshot',
    'subscribe',
    'unsubscribe',
  ])
  assert.deepEqual(HOST_ERROR_CODES, [
    'policy_denied',
    'unavailable',
    'validation_error',
    'runtime_error',
    'not_active',
    'already_active',
  ])
  assert.deepEqual(HOST_EVENT_NAMES, [
    'nextv_started',
    'nextv_stopped',
    'nextv_runtime_event',
    'nextv_execution',
    'nextv_error',
    'nextv_timer_pulse',
    'nextv_event_queued',
  ])
})
