export class EventEmitter {
  constructor() {
    this.listenersByEvent = new Map()
  }

  on(eventName, listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function')
    }

    let listeners = this.listenersByEvent.get(eventName)
    if (!listeners) {
      listeners = new Set()
      this.listenersByEvent.set(eventName, listeners)
    }

    listeners.add(listener)
    return () => this.off(eventName, listener)
  }

  off(eventName, listener) {
    const listeners = this.listenersByEvent.get(eventName)
    if (!listeners) {
      return
    }

    listeners.delete(listener)
    if (listeners.size === 0) {
      this.listenersByEvent.delete(eventName)
    }
  }

  emit(eventName, payload) {
    const listeners = this.listenersByEvent.get(eventName)
    if (!listeners) {
      return
    }

    for (const listener of listeners) {
      listener(payload)
    }
  }
}
