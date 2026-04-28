function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function toArray(value) {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
}

export function createPollingIngressConnector({
  poll,
  mapItemToEvent,
  mapItemsToEvents,
  normalizeInput,
  defaultEventType = 'ingress_item',
} = {}) {
  if (typeof poll !== 'function') {
    throw new Error('createPollingIngressConnector requires poll function.')
  }

  return async (payload = {}) => {
    const baseInput = toObject(payload)
    const input = typeof normalizeInput === 'function'
      ? toObject(normalizeInput(baseInput))
      : baseInput

    const result = await poll(input)
    const items = toArray(result?.items)

    if (typeof mapItemsToEvents === 'function') {
      const mapped = mapItemsToEvents(items, {
        input,
        result,
        eventType: String(input.eventType ?? defaultEventType).trim() || defaultEventType,
      })
      return toArray(mapped).filter((event) => event && typeof event === 'object')
    }

    if (typeof mapItemToEvent !== 'function') {
      throw new Error('createPollingIngressConnector requires mapItemToEvent or mapItemsToEvents.')
    }

    const eventType = String(input.eventType ?? defaultEventType).trim() || defaultEventType
    return items
      .map((item) => mapItemToEvent(item, { input, result, eventType }))
      .filter((event) => event && typeof event === 'object')
  }
}
