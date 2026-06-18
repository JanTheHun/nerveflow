function normalizeString(value) {
  const text = String(value || '').trim()
  return text || ''
}

function buildRuntimeErrorGuidance(entry) {
  const code = normalizeString(entry?.code).toUpperCase()
  const message = normalizeString(entry?.message).toLowerCase()

  if (code === 'AGENT_NOT_FOUND' || message.includes('profile was not found')) {
    return 'Add an assistant profile in agents.json, or change the generated workflow call to a configured profile name.'
  }

  if (code === 'AGENT_MISSING_MODEL_REF' || message.includes('missing model')) {
    return 'Set the profile model in agents.json and ensure that model alias exists in models.json.'
  }

  if (code === 'AGENT_MODEL_NOT_CONFIGURED' || message.includes('not configured in workspace models map')) {
    return 'Add the model alias to models.json and reference a valid transport from transports.json.'
  }

  return ''
}

function normalizeRuntimeErrorEvent(eventEnvelope) {
  if (!eventEnvelope || eventEnvelope.eventName !== 'nextv_error') {
    return null
  }

  const payload = eventEnvelope.payload && typeof eventEnvelope.payload === 'object'
    ? eventEnvelope.payload
    : {}

  const entry = {
    timestamp: normalizeString(eventEnvelope.timestamp),
    sequence: Number.isFinite(Number(eventEnvelope.sequence)) ? Number(eventEnvelope.sequence) : null,
    code: normalizeString(payload.code) || 'NEXTV_ERROR',
    message: normalizeString(payload.message) || 'Runtime execution failed.',
    sourcePath: normalizeString(payload.sourcePath),
    sourceLine: Number.isFinite(Number(payload.sourceLine)) ? Number(payload.sourceLine) : null,
    statement: normalizeString(payload.statement),
  }

  entry.guidance = buildRuntimeErrorGuidance(entry)
  return entry
}

module.exports = {
  buildRuntimeErrorGuidance,
  normalizeRuntimeErrorEvent,
}
