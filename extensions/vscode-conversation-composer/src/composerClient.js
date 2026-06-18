const { EventEmitter } = require('node:events')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')
const WebSocket = require('ws')

const DEFAULT_TIMEOUT_MS = 10000
const CONNECT_TIMEOUT_MS = 8000
const EMBEDDED_RUNTIME_MODULE_PATH = path.join(__dirname, '..', 'dist', 'embedded-runtime', 'index.cjs')

class ComposerClient extends EventEmitter {
  constructor({ getEndpoint, getWorkspaceDir, getSessionRoot, getDefaultModel, embeddedRuntimeModulePath }) {
    super()
    this.getEndpoint = getEndpoint
    this.getWorkspaceDir = getWorkspaceDir
    this.getSessionRoot = getSessionRoot
    this.getDefaultModel = getDefaultModel
    this.embeddedRuntimeModulePath = String(embeddedRuntimeModulePath || EMBEDDED_RUNTIME_MODULE_PATH)
    this.ws = null
    this.connected = false
    this.sessionId = null
    this.pending = new Map()
    this.host = null
    this.runtimeDeps = null
  }

  async connect() {
    if (this.ws && this.connected) {
      return { connected: true, sessionId: this.sessionId }
    }

    const endpoint = String(this.getEndpoint?.() || '').trim()
    if (!endpoint) {
      throw new Error('Runtime endpoint is not configured.')
    }

    this.emit('status', { connected: false, connecting: true, endpoint })
    this.emit('trace', { kind: 'connect_begin', endpoint })
    await this.#ensureEmbeddedHostStarted(endpoint)
    await this.#open(endpoint)
    try {
      await this.subscribe()
    } catch {
      // Subscribe timeout can happen when host ignores response but still subscribes.
      this.emit('trace', { kind: 'subscribe_timeout_ignored', endpoint })
    }
    this.emit('status', { connected: true, endpoint, sessionId: this.sessionId })
    this.emit('trace', { kind: 'connect_ready', endpoint, sessionId: this.sessionId || null })
    return { connected: true, endpoint, sessionId: this.sessionId }
  }

  async disconnect() {
    this.emit('trace', { kind: 'disconnect_begin' })
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

    if (this.host && typeof this.host.shutdown === 'function') {
      try {
        await this.host.shutdown()
      } catch {
        // no-op
      }
    }
    this.host = null

    this.emit('status', { connected: false })
    this.emit('trace', { kind: 'disconnect_done' })
  }

  async subscribe() {
    return this.sendCommand('subscribe', {})
  }

  async refreshSnapshot() {
    return this.sendCommand('snapshot', {})
  }

  async sendUserMessage(text) {
    const value = String(text || '').trim()
    if (!value) {
      throw new Error('Message cannot be empty.')
    }
    return this.sendCommand('enqueue_event', {
      eventType: 'user_message',
      value,
    })
  }

  async sendCommand(type, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.ws || !this.connected) {
      throw new Error('Runtime is not connected.')
    }

    const requestId = randomUUID()
    const startedAt = Date.now()
    const envelope = {
      type,
      requestId,
      payload: payload || {},
    }

    this.emit('trace', {
      kind: 'command_send',
      requestId,
      type,
      timeoutMs,
      payloadSummary: this.#summarizePayload(payload),
    })

    const responsePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId)
        this.emit('trace', {
          kind: 'command_timeout',
          requestId,
          type,
          timeoutMs,
          elapsedMs: Date.now() - startedAt,
        })
        reject(new Error(`Timed out waiting for ${type} response.`))
      }, timeoutMs)
      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        type,
        startedAt,
      })
    })

    try {
      this.ws.send(JSON.stringify(envelope))
    } catch (error) {
      this.pending.delete(requestId)
      this.emit('trace', {
        kind: 'command_send_failed',
        requestId,
        type,
        error: String(error?.message || error),
      })
      throw error
    }

    return responsePromise
  }

  #open(endpoint) {
    return new Promise((resolve, reject) => {
      this.emit('trace', { kind: 'socket_open_begin', endpoint })
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
        this.emit('trace', { kind: 'socket_open_success', endpoint })
        resolve()
      })

      ws.once('error', (error) => {
        clearTimeout(timeout)
        this.emit('trace', {
          kind: 'socket_open_error',
          endpoint,
          error: String(error?.message || error),
        })
        if (!settled) {
          settled = true
          reject(error)
          return
        }
        this.emit('error', { message: error?.message || String(error) })
      })
    })
  }

  async #ensureEmbeddedHostStarted(endpoint) {
    if (this.host) {
      return
    }

    const workspaceDir = String(this.getWorkspaceDir?.() || '').trim()
    if (!workspaceDir) {
      throw new Error('Open a workspace folder before connecting Conversation Composer.')
    }
    const sessionRoot = String(this.getSessionRoot?.() || '').trim()
    if (!sessionRoot) {
      throw new Error('Composer session storage is unavailable for this workspace.')
    }

    const parsedEndpoint = new URL(endpoint)
    if (parsedEndpoint.protocol !== 'ws:' && parsedEndpoint.protocol !== 'wss:') {
      throw new Error('Composer runtime endpoint must use ws:// or wss:// protocol.')
    }

    const parsedPort = Number(parsedEndpoint.port || (parsedEndpoint.protocol === 'wss:' ? 443 : 80))
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      throw new Error('Composer runtime endpoint port is invalid.')
    }

    const wsPath = String(parsedEndpoint.pathname || '/api/runtime/ws').trim() || '/api/runtime/ws'

    await this.#ensureWorkspaceRuntimeConfig(sessionRoot)

    let runtimeDeps
    try {
      runtimeDeps = await this.#loadRuntimeDeps()
    } catch (error) {
      const message = String(error?.message || error)
      this.emit('error', {
        message: `Unable to load embedded runtime bundle. Falling back to configured runtime endpoint. Details: ${message}`,
      })
      return
    }

    const defaultModel = String(this.getDefaultModel?.() || '').trim()
    const callAgent = runtimeDeps.createOllamaTransport({
      baseUrl: String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').trim(),
    })

    const host = runtimeDeps.createComposableHost({
      repoRoot: sessionRoot,
      workspaceDir: '.',
      port: parsedPort,
      autoAttachCapabilitiesFromWorkspace: false,
      callAgent,
      defaultModel,
    })

    host.attachSurface(runtimeDeps.wsSurface({ path: wsPath }))

    try {
      await host.start()
      this.host = host
      this.emit('trace', {
        kind: 'embedded_runtime_started',
        endpoint,
        port: parsedPort,
        path: wsPath,
      })
      this.emit('status', {
        connected: false,
        connecting: true,
        endpoint,
        embeddedRuntime: true,
      })
    } catch (error) {
      const message = String(error?.message || error)
      if (error?.code === 'EADDRINUSE' || /EADDRINUSE/i.test(message)) {
        this.emit('trace', {
          kind: 'embedded_runtime_port_in_use',
          endpoint,
          port: parsedPort,
        })
        this.emit('error', {
          message: 'Composer embedded runtime port is already in use. Falling back to existing runtime endpoint.',
        })
        return
      }
      this.emit('trace', {
        kind: 'embedded_runtime_start_failed',
        endpoint,
        error: message,
      })
      this.emit('error', {
        message: `Composer embedded runtime failed to start. Falling back to configured runtime endpoint. Details: ${message}`,
      })
      return
    }
  }

  async #ensureWorkspaceRuntimeConfig(workspaceDir) {
    const defaultModel = String(this.getDefaultModel?.() || '').trim() || 'qwen3-coder'

    const hasEntrypointInRootConfig = async (fileName) => {
      const filePath = path.join(workspaceDir, fileName)
      try {
        const raw = await fs.readFile(filePath, 'utf8')
        const parsed = JSON.parse(raw)
        const entrypointPath = String(parsed?.entrypointPath || '').trim()
        return Boolean(entrypointPath)
      } catch (error) {
        if (error?.code === 'ENOENT') return false
        return false
      }
    }

    const hasEntrypoint = await hasEntrypointInRootConfig('nextv.json')
      || await hasEntrypointInRootConfig('nerve.json')

    if (hasEntrypoint) {
      return
    }

    const { initializeWorkspace } = require('./workspaceInitializer.js')
    await initializeWorkspace(workspaceDir, [defaultModel])
  }

  async #loadRuntimeDeps() {
    if (this.runtimeDeps) {
      return this.runtimeDeps
    }

    const embeddedRuntimeModule = require(this.embeddedRuntimeModulePath)

    this.runtimeDeps = {
      createComposableHost: embeddedRuntimeModule.createComposableHost,
      wsSurface: embeddedRuntimeModule.wsSurface,
      createOllamaTransport: embeddedRuntimeModule.createOllamaTransport,
    }

    return this.runtimeDeps
  }

  #attachSocketHandlers(ws) {
    ws.on('close', () => {
      this.connected = false
      this.ws = null
      this.#rejectPending(new Error('Connection closed.'))
      this.emit('status', { connected: false })
      this.emit('trace', { kind: 'socket_closed' })
    })

    ws.on('error', (error) => {
      this.emit('trace', { kind: 'socket_error', error: String(error?.message || error) })
      this.emit('error', { message: error?.message || String(error) })
    })

    ws.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw || '{}'))
      } catch {
        this.emit('trace', { kind: 'socket_invalid_json' })
        this.emit('error', { message: 'Received invalid JSON from runtime endpoint.' })
        return
      }

      if (message?.type === 'response') {
        const response = message
        if (!response.requestId) {
          if (response.sessionId) {
            this.sessionId = response.sessionId
            this.emit('trace', {
              kind: 'session_updated',
              sessionId: this.sessionId,
            })
          }
          return
        }

        const pendingEntry = this.pending.get(response.requestId)
        if (!pendingEntry) {
          this.emit('trace', {
            kind: 'command_response_unmatched',
            requestId: response.requestId,
            ok: response.ok !== false,
          })
          return
        }
        this.pending.delete(response.requestId)
        clearTimeout(pendingEntry.timeout)
        const elapsedMs = Date.now() - Number(pendingEntry.startedAt || Date.now())

        if (response.ok === false) {
          this.emit('trace', {
            kind: 'command_response_error',
            requestId: response.requestId,
            type: pendingEntry.type,
            elapsedMs,
            error: String(response?.error?.message || 'Runtime command failed.'),
          })
          pendingEntry.reject(new Error(response?.error?.message || 'Runtime command failed.'))
          return
        }

        if (response.sessionId) {
          this.sessionId = response.sessionId
        }
        this.emit('trace', {
          kind: 'command_response_ok',
          requestId: response.requestId,
          type: pendingEntry.type,
          elapsedMs,
          sessionId: this.sessionId || null,
        })
        pendingEntry.resolve(response)
        return
      }

      if (message?.type === 'event') {
        this.emit('trace', {
          kind: 'runtime_event_received',
          eventName: String(message.eventName || 'unknown_event'),
          sequence: Number.isFinite(Number(message.sequence)) ? Number(message.sequence) : null,
        })
        this.emit('runtimeEvent', {
          eventName: String(message.eventName || 'unknown_event'),
          timestamp: message.timestamp,
          sequence: message.sequence,
          payload: message.payload,
        })
      }
    })
  }

  #summarizePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { kind: typeof payload }
    }
    const keys = Object.keys(payload)
    const summary = {
      kind: 'object',
      keys,
    }
    if (typeof payload.value === 'string') {
      summary.valueLength = payload.value.length
    }
    if (typeof payload.eventType === 'string') {
      summary.eventType = payload.eventType
    }
    return summary
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
  ComposerClient,
}
