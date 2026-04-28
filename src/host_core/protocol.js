/**
 * Host protocol v1.0 — Transport-agnostic envelope for command/response/event communication.
 *
 * Multi-Surface Semantics:
 * 
 * Nerveflow supports a single runtime session with multiple dynamically attached surfaces.
 * Surfaces attach via 'subscribe' and detach via 'unsubscribe' commands.
 * 
 * - subscribe: Surface attachment request. Handler receives all subsequent runtime events.
 * - unsubscribe: Surface detachment. Handler is removed; no more events delivered to it.
 * - Handler failures (throws) are caught and isolated; failing handler is removed automatically.
 *   Other subscribed surfaces continue receiving events.
 * 
 * Command types:
 * - start: Create and run runtime in workspace
 * - stop: Halt runtime
 * - enqueue_event: Feed input event to runtime
 * - dispatch_ingress: Dispatch ingress connector output into runtime queue
 * - snapshot: Get current runtime state
 * - subscribe: Attach surface to runtime events
 * - unsubscribe: Detach surface from runtime events
 * 
 * Event names are published by runtime to all subscribed surfaces:
 * - nextv_started: Runtime initialized
 * - nextv_stopped: Runtime halted
 * - nextv_warning: Policy or effect binding warning
 * - nextv_runtime_event: Input event received
 * - nextv_execution: Script execution complete
 * - nextv_error: Execution error
 * - nextv_timer_pulse: Periodic timer fired
 * - nextv_event_queued: Event added to queue
 * - nextv_ingress_dispatched: Ingress dispatch routed and enqueued
 * - nextv_effect_realized: Declared effect channel realized by host
 * 
 * Error codes indicate protocol or policy violations:
 * - policy_denied: Tool/effect not allowed
 * - unavailable: Tool/effect not implemented
 * - validation_error: Malformed command
 * - runtime_error: Execution failure
 * - not_active: Runtime not running
 * - already_active: Runtime already started
 */

const HOST_PROTOCOL_VERSION = '1.0'

const HOST_COMMAND_TYPES = Object.freeze([
  'start',
  'stop',
  'enqueue_event',
  'dispatch_ingress',
  'snapshot',
  'subscribe',
  'unsubscribe',
])

const HOST_EVENT_NAMES = Object.freeze([
  'nextv_started',
  'nextv_stopped',
  'nextv_warning',
  'nextv_runtime_event',
  'nextv_execution',
  'nextv_error',
  'nextv_timer_pulse',
  'nextv_event_queued',
  'nextv_ingress_dispatched',
  'nextv_effect_realized',
])

const HOST_ERROR_CODES = Object.freeze([
  'policy_denied',
  'unavailable',
  'validation_error',
  'runtime_error',
  'not_active',
  'already_active',
])

function ensureObject(value, contextLabel) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${contextLabel} must be an object.`)
  }
}

function ensureOptionalNonEmptyString(value, fieldName) {
  if (value == null) return undefined
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string when provided.`)
  }
  return value.trim()
}

function ensureKnownValue(value, knownValues, fieldName) {
  if (!knownValues.includes(value)) {
    throw new Error(`${fieldName} must be one of: ${knownValues.join(', ')}`)
  }
  return value
}

function normalizeTimestamp(value) {
  if (value == null) return new Date().toISOString()
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('timestamp must be a non-empty string when provided.')
  }
  return value.trim()
}

export function validateHostProtocolCommand(commandRaw, options = {}) {
  ensureObject(commandRaw, 'command')

  const knownCommands = Array.isArray(options.knownCommands) && options.knownCommands.length > 0
    ? options.knownCommands
    : HOST_COMMAND_TYPES

  const allowUnknownCommands = options.allowUnknownCommands === true
  const type = ensureOptionalNonEmptyString(commandRaw.type, 'command.type')
  if (!allowUnknownCommands) {
    ensureKnownValue(type, knownCommands, 'command.type')
  }

  return {
    protocolVersion: ensureOptionalNonEmptyString(commandRaw.protocolVersion, 'command.protocolVersion') || HOST_PROTOCOL_VERSION,
    type,
    requestId: ensureOptionalNonEmptyString(commandRaw.requestId, 'command.requestId'),
    sessionId: ensureOptionalNonEmptyString(commandRaw.sessionId, 'command.sessionId'),
    payload: commandRaw.payload,
    timestamp: normalizeTimestamp(commandRaw.timestamp),
  }
}

export function normalizeHostProtocolError(errorRaw) {
  ensureObject(errorRaw, 'error')

  const code = ensureOptionalNonEmptyString(errorRaw.code, 'error.code')
  ensureKnownValue(code, HOST_ERROR_CODES, 'error.code')

  const message = ensureOptionalNonEmptyString(errorRaw.message, 'error.message')

  return {
    code,
    message,
    details: errorRaw.details,
  }
}

export function buildHostProtocolResponse({
  requestId,
  sessionId,
  ok = true,
  data,
  error,
  capabilities,
  protocolVersion = HOST_PROTOCOL_VERSION,
  timestamp,
} = {}) {
  const normalizedRequestId = ensureOptionalNonEmptyString(requestId, 'response.requestId')
  const normalizedSessionId = ensureOptionalNonEmptyString(sessionId, 'response.sessionId')

  if (typeof ok !== 'boolean') {
    throw new Error('response.ok must be a boolean.')
  }

  const response = {
    protocolVersion: ensureOptionalNonEmptyString(protocolVersion, 'response.protocolVersion') || HOST_PROTOCOL_VERSION,
    requestId: normalizedRequestId,
    sessionId: normalizedSessionId,
    ok,
    timestamp: normalizeTimestamp(timestamp),
  }

  if (capabilities != null) {
    ensureObject(capabilities, 'response.capabilities')
    response.capabilities = capabilities
  }

  if (ok) {
    response.data = data
    if (error != null) {
      throw new Error('response.error must be omitted when response.ok is true.')
    }
  } else {
    response.error = normalizeHostProtocolError(error)
    if (data != null) {
      throw new Error('response.data must be omitted when response.ok is false.')
    }
  }

  return response
}

export function buildHostProtocolEvent({
  eventName,
  payload,
  sessionId,
  sequence,
  protocolVersion = HOST_PROTOCOL_VERSION,
  timestamp,
  allowUnknownEvents = false,
  knownEvents,
} = {}) {
  const normalizedEventName = ensureOptionalNonEmptyString(eventName, 'event.eventName')
  const knownEventNames = Array.isArray(knownEvents) && knownEvents.length > 0
    ? knownEvents
    : HOST_EVENT_NAMES

  if (!allowUnknownEvents) {
    ensureKnownValue(normalizedEventName, knownEventNames, 'event.eventName')
  }

  if (sequence != null && (!Number.isInteger(sequence) || sequence < 0)) {
    throw new Error('event.sequence must be a non-negative integer when provided.')
  }

  return {
    protocolVersion: ensureOptionalNonEmptyString(protocolVersion, 'event.protocolVersion') || HOST_PROTOCOL_VERSION,
    eventName: normalizedEventName,
    payload,
    sessionId: ensureOptionalNonEmptyString(sessionId, 'event.sessionId'),
    sequence: sequence ?? null,
    timestamp: normalizeTimestamp(timestamp),
  }
}

export {
  HOST_COMMAND_TYPES,
  HOST_ERROR_CODES,
  HOST_EVENT_NAMES,
  HOST_PROTOCOL_VERSION,
}
