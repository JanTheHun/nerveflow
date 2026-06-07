const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const WebSocket = require('ws')

const DEFAULT_TIMEOUT_MS = 10000
const CONNECT_TIMEOUT_MS = 8000

class RuntimeClient extends EventEmitter {
  constructor({ getEndpoint }) {
    super()
    this.getEndpoint = getEndpoint
    this.ws = null
    this.sessionId = null
    this.connected = false
    this.pending = new Map()
  }

  async connect() {
    if (this.ws && this.connected) {
      return { connected: true, sessionId: this.sessionId }
    }

    const endpoint = String(this.getEndpoint?.() || '').trim()
    if (!endpoint) {
      throw new Error('Runtime endpoint is not configured.')
    }

    this.emit('status', {
      connected: false,
      connecting: true,
      endpoint,
    })

    await this.#open(endpoint)
    try {
      await this.subscribe()
    } catch (error) {
      const message = String(error?.message || '')
      if (!message.includes('Timed out waiting for subscribe response.')) {
        throw error
      }
      this.emit('warning', {
        message: 'Subscribe response timeout; continuing with optimistic subscription state.',
      })
    }
    this.emit('status', {
      connected: true,
      endpoint,
      sessionId: this.sessionId,
    })

    return {
      connected: true,
      endpoint,
      sessionId: this.sessionId,
    }
  }

  async disconnect() {
    this.connected = false
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        // no-op
      }
    }
    this.ws = null
    this.sessionId = null
    this.#rejectPending(new Error('Disconnected'))
    this.emit('status', { connected: false })
  }

  async subscribe() {
    return this.sendCommand('subscribe', {})
  }

  async sendUserMessage(messageText) {
    const message = String(messageText || '').trim()
    if (!message) {
      throw new Error('Message cannot be empty.')
    }

    return this.sendCommand('enqueue_event', {
      eventType: 'user_message',
      value: message,
    })
  }

  async refreshSnapshot() {
    return this.sendCommand('snapshot', {})
  }

  async sendCommand(type, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.ws || !this.connected) {
      throw new Error('Runtime is not connected.')
    }

    const requestId = randomUUID()
    const envelope = {
      type,
      requestId,
      payload: payload || {},
    }

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Timed out waiting for ${type} response.`))
      }, timeoutMs)

      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
      })
    })

    this.ws.send(JSON.stringify(envelope))
    return responsePromise
  }

  #open(endpoint) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(endpoint)
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          ws.terminate()
        } catch {
          // no-op
        }
        reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms.`))
      }, CONNECT_TIMEOUT_MS)

      ws.once('open', () => {
        clearTimeout(timeout)
        this.ws = ws
        this.connected = true
        settled = true
        this.#attachSocketHandlers(ws)
        resolve()
      })

      ws.once('error', (error) => {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          reject(error)
          return
        }
        this.emit('error', {
          message: error?.message || String(error),
        })
      })
    })
  }

  #attachSocketHandlers(ws) {
    ws.on('close', () => {
      this.connected = false
      this.ws = null
      this.#rejectPending(new Error('Connection closed.'))
      this.emit('status', { connected: false })
    })

    ws.on('error', (error) => {
      this.emit('error', {
        message: error?.message || String(error),
      })
    })

    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw || '{}'))
      } catch {
        this.emit('error', {
          message: 'Received invalid JSON from runtime endpoint.',
        })
        return
      }

      if (message?.type === 'response') {
        const response = message
        if (!response.requestId) {
          if (response.sessionId) {
            this.sessionId = response.sessionId
          }
          this.emit('handshake', response)
          return
        }

        const pendingEntry = this.pending.get(response.requestId)
        if (!pendingEntry) {
          return
        }
        this.pending.delete(response.requestId)
        clearTimeout(pendingEntry.timeout)

        if (response.ok === false) {
          pendingEntry.reject(new Error(response?.error?.message || 'Runtime command failed.'))
          return
        }

        if (response.sessionId) {
          this.sessionId = response.sessionId
        }
        pendingEntry.resolve(response)
        return
      }

      if (message?.type === 'event') {
        const eventName = String(message.eventName || 'unknown_event')
        if (eventName !== 'nextv_execution' && eventName !== 'nextv_runtime_event' && eventName !== 'nextv_error') {
          return
        }

        this.emit('runtimeEvent', {
          eventName,
          timestamp: message.timestamp,
          sequence: message.sequence,
          payload: message.payload,
        })
      }
    })
  }

  #rejectPending(error) {
    for (const [, pendingEntry] of this.pending.entries()) {
      clearTimeout(pendingEntry.timeout)
      pendingEntry.reject(error)
    }
    this.pending.clear()
  }
}

module.exports = {
  RuntimeClient,
}
