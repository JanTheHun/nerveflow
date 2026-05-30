function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toTrimmedString(value) {
  return String(value ?? '').trim()
}

function isIsoTimestamp(value) {
  const text = toTrimmedString(value)
  if (!text) return false
  const parsed = Date.parse(text)
  return Number.isFinite(parsed)
}

function normalizeTerminalStateFromAction(actionRaw) {
  const action = toTrimmedString(actionRaw).toLowerCase()
  if (action === 'selected' || action === 'submitted' || action === 'confirmed' || action === 'resolved') {
    return 'resolved'
  }
  if (action === 'cancelled' || action === 'canceled' || action === 'dismissed') {
    return 'cancelled'
  }
  if (action === 'timed_out' || action === 'timeout') {
    return 'timed_out'
  }
  if (action === 'failed' || action === 'error') {
    return 'failed'
  }
  return null
}

function buildInteractionKey(interactionIdRaw, targetRaw) {
  const interactionId = toTrimmedString(interactionIdRaw)
  const target = toTrimmedString(targetRaw)
  return `${target}::${interactionId}`
}

function ensureValidEffectEnvelope(rawEnvelope, effectNameRaw) {
  if (!isPlainObject(rawEnvelope)) {
    throw new Error('semantic-surface effect envelope must be an object')
  }

  const effectName = toTrimmedString(rawEnvelope.effectName || effectNameRaw)
  const schemaVersion = toTrimmedString(rawEnvelope.schemaVersion)
  const capability = toTrimmedString(rawEnvelope.capability)
  const interactionId = toTrimmedString(rawEnvelope.interactionId)
  const target = toTrimmedString(rawEnvelope.target)
  const runtimeEventId = toTrimmedString(rawEnvelope.runtimeEventId)

  if (!schemaVersion) throw new Error('semantic-surface effect envelope requires schemaVersion')
  if (!capability) throw new Error('semantic-surface effect envelope requires capability')
  if (!effectName) throw new Error('semantic-surface effect envelope requires effectName')
  if (!interactionId) throw new Error('semantic-surface effect envelope requires interactionId')
  if (!target) throw new Error('semantic-surface effect envelope requires target')
  if (!runtimeEventId) throw new Error('semantic-surface effect envelope requires runtimeEventId')
  if (!isPlainObject(rawEnvelope.intent)) throw new Error('semantic-surface effect envelope requires intent object')
  if (!isIsoTimestamp(rawEnvelope.timestamp)) throw new Error('semantic-surface effect envelope requires ISO-8601 timestamp')

  return {
    schemaVersion,
    capability,
    effectName,
    interactionId,
    target,
    intent: rawEnvelope.intent,
    timestamp: toTrimmedString(rawEnvelope.timestamp),
    runtimeEventId,
  }
}

function ensureValidIngressEnvelope(rawEnvelope) {
  if (!isPlainObject(rawEnvelope)) {
    throw new Error('semantic-surface ingress envelope must be an object')
  }

  const schemaVersion = toTrimmedString(rawEnvelope.schemaVersion)
  const eventType = toTrimmedString(rawEnvelope.eventType)
  const interactionId = toTrimmedString(rawEnvelope.interactionId)
  const target = toTrimmedString(rawEnvelope.target)
  const action = toTrimmedString(rawEnvelope.action)
  const sourceSessionId = toTrimmedString(rawEnvelope.sourceSessionId)

  if (!schemaVersion) throw new Error('semantic-surface ingress envelope requires schemaVersion')
  if (eventType !== 'semantic_surface_event') {
    throw new Error('semantic-surface ingress envelope requires eventType semantic_surface_event')
  }
  if (!interactionId) throw new Error('semantic-surface ingress envelope requires interactionId')
  if (!target) throw new Error('semantic-surface ingress envelope requires target')
  if (!action) throw new Error('semantic-surface ingress envelope requires action')
  if (!Object.prototype.hasOwnProperty.call(rawEnvelope, 'value')) {
    throw new Error('semantic-surface ingress envelope requires value')
  }
  if (!isIsoTimestamp(rawEnvelope.timestamp)) throw new Error('semantic-surface ingress envelope requires ISO-8601 timestamp')
  if (!sourceSessionId) throw new Error('semantic-surface ingress envelope requires sourceSessionId')

  return {
    schemaVersion,
    eventType,
    interactionId,
    target,
    action,
    value: rawEnvelope.value,
    timestamp: toTrimmedString(rawEnvelope.timestamp),
    sourceSessionId,
  }
}

function buildDefaultEffectRealizer({ interactionState, now = () => new Date().toISOString() } = {}) {
  const realizeSemanticSurface = async (payload = {}) => {
      const effectName = toTrimmedString(payload?.name ?? payload?.effectName ?? payload?.effectChannelId ?? 'semantic_surface') || 'semantic_surface'
      const eventValue = isPlainObject(payload?.runtimeEvent?.value)
        ? payload.runtimeEvent.value
        : (isPlainObject(payload?.event?.value)
          ? payload.event.value
          : (isPlainObject(payload?.value) ? payload.value : null))
      const candidateEnvelope = isPlainObject(eventValue)
        ? {
            ...eventValue,
            effectName: eventValue.effectName ?? effectName,
            schemaVersion: eventValue.schemaVersion ?? '1.0',
            capability: eventValue.capability ?? 'semantic-surface',
            timestamp: eventValue.timestamp ?? now(),
            runtimeEventId: eventValue.runtimeEventId ?? toTrimmedString(payload?.runtimeEvent?.id ?? payload?.runtimeEvent?.eventId),
          }
        : null

      const envelope = ensureValidEffectEnvelope(candidateEnvelope, effectName)
      const key = buildInteractionKey(envelope.interactionId, envelope.target)
      const previousState = interactionState.get(key)
      const nextState = {
        state: previousState?.state === 'requested' ? 'presented' : 'requested',
        updatedAt: now(),
      }
      interactionState.set(key, nextState)

      return {
        ok: true,
        effectName: envelope.effectName,
        interactionId: envelope.interactionId,
        target: envelope.target,
        lifecycleState: nextState.state,
      }
    }

  return {
    semantic_surface: realizeSemanticSurface,
    // Compatibility alias while naming settles in docs.
    semantic_ui: realizeSemanticSurface,
  }
}

function buildDefaultIngressConnector({ interactionState, now = () => new Date().toISOString() } = {}) {
  const dispatchSemanticSurfaceEvent = async (payload = {}) => {
      const input = ensureValidIngressEnvelope(payload)
      const key = buildInteractionKey(input.interactionId, input.target)
      const previousState = interactionState.get(key)
      const terminalState = normalizeTerminalStateFromAction(input.action)

      if (previousState?.terminal === true) {
        return []
      }

      const nextState = {
        state: terminalState || 'updated',
        terminal: Boolean(terminalState),
        updatedAt: now(),
      }
      interactionState.set(key, nextState)

      return {
        type: input.eventType,
        source: 'external',
        value: {
          interactionId: input.interactionId,
          target: input.target,
          action: input.action,
          payload: input.value,
          sourceSessionId: input.sourceSessionId,
          schemaVersion: input.schemaVersion,
          timestamp: input.timestamp,
        },
      }
    }

  return {
    semantic_surface_event: dispatchSemanticSurfaceEvent,
    semantic_ui_event: async (payload = {}) => dispatchSemanticSurfaceEvent({
      ...payload,
      eventType: payload?.eventType || 'semantic_surface_event',
    }),
  }
}

export function semanticSurfaceCapability({
  connector,
  realizer,
  now,
} = {}) {
  const interactionState = new Map()
  const currentIsoTime = typeof now === 'function' ? now : () => new Date().toISOString()

  const ingressConnectors = [connector || buildDefaultIngressConnector({ interactionState, now: currentIsoTime })]
  const effectRealizers = [realizer || buildDefaultEffectRealizer({ interactionState, now: currentIsoTime })]

  return {
    ingressConnectors,
    effectRealizers,
    setup: async () => {
      interactionState.clear()
      return {
        ok: true,
        pendingInteractions: [],
      }
    },
    teardown: async () => {
      interactionState.clear()
      return { ok: true }
    },
    getPendingInteractions: () => {
      const entries = []
      for (const [key, state] of interactionState.entries()) {
        if (state?.terminal) continue
        const split = key.split('::')
        const target = split[0] || ''
        const interactionId = split.slice(1).join('::')
        if (!target || !interactionId) continue
        entries.push({
          target,
          interactionId,
          state: state.state,
          updatedAt: state.updatedAt,
        })
      }
      return entries
    },
  }
}
