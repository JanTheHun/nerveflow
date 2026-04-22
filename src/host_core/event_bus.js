/**
 * Generic runtime event fanout bus.
 *
 * Transports (SSE, WebSocket, CLI, embedded callbacks) subscribe a handler
 * function and receive every published event. The bus itself has no knowledge
 * of the transport protocol.
 *
 * @returns {{ publish, subscribe, unsubscribe, size }}
 */
export function createEventBus() {
  const handlers = new Set()

  return {
    /**
     * Deliver eventName + payload to every registered handler.
     * A handler that throws is caught and removed.
     *
     * @param {string} eventName
     * @param {unknown} payload
     */
    publish(eventName, payload) {
      for (const handler of handlers) {
        try {
          handler(eventName, payload)
        } catch {
          handlers.delete(handler)
        }
      }
    },

    /**
     * Register a listener.  handler(eventName, payload) will be called for
     * every subsequent publish().
     *
     * @param {(eventName: string, payload: unknown) => void} handler
     */
    subscribe(handler) {
      handlers.add(handler)
    },

    /**
     * Remove a previously registered listener.
     *
     * @param {(eventName: string, payload: unknown) => void} handler
     */
    unsubscribe(handler) {
      handlers.delete(handler)
    },

    /** Number of currently active subscribers. */
    get size() {
      return handlers.size
    },
  }
}
