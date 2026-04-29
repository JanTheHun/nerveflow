import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

function mapConnectionError(err) {
  const message = String(err?.message ?? err ?? 'remote runtime connection failed')
  return new Error(message)
}

export function createWsRemoteBridge({
  wsUrl,
  eventBus,
  createClient,
  commandTimeoutMs = 10000,
  reconnectBaseDelayMs = 250,
  reconnectMaxDelayMs = 5000,
} = {}) {
  if (!wsUrl || typeof wsUrl !== 'string') {
    throw new Error('createWsRemoteBridge: wsUrl is required')
  }
  if (!eventBus || typeof eventBus.publish !== 'function') {
    throw new Error('createWsRemoteBridge: eventBus with publish() is required')
  }

  const socketFactory = typeof createClient === 'function'
    ? createClient
    : (url) => new WebSocket(url)

  let ws = null
  let stopping = false
  let connected = false
  let connecting = false
  let reconnectDelayMs = reconnectBaseDelayMs
  let reconnectTimer = null
  let connectAttemptId = 0
  let lastError = null
  let sessionId = ''
  let cachedSnapshot = null
  let remoteActive = false
  let cachedWorkspaceDir = ''
  let cachedEntrypointPath = ''

  const pendingByRequestId = new Map()

  function clearPendingWithError(err) {
    for (const [requestId, pending] of pendingByRequestId.entries()) {
      clearTimeout(pending.timeoutId)
      pending.reject(err)
      pendingByRequestId.delete(requestId)
    }
  }

  function updateSnapshotFromPayload(payload) {
    if (!payload || typeof payload !== 'object') return
    const workspaceDir = String(payload.workspaceDir ?? payload.snapshot?.workspaceDir ?? '').trim()
    const entrypointPath = String(payload.entrypointPath ?? payload.snapshot?.entrypointPath ?? '').trim()
    if (workspaceDir) cachedWorkspaceDir = workspaceDir
    if (entrypointPath) cachedEntrypointPath = entrypointPath
    if (payload.snapshot && typeof payload.snapshot === 'object') {
      cachedSnapshot = payload.snapshot
      remoteActive = payload.snapshot.running === true
      return
    }
    if (typeof payload.running === 'boolean') {
      remoteActive = payload.running
    }
  }

  function scheduleReconnect() {
    if (stopping) return
    if (reconnectTimer) return

    const delay = reconnectDelayMs
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectInternal()
    }, delay)

    reconnectDelayMs = Math.min(reconnectMaxDelayMs, Math.max(reconnectBaseDelayMs, reconnectDelayMs * 2))
  }

  function connectInternal() {
    if (stopping || connected || connecting) return

    connecting = true
    const attemptId = ++connectAttemptId

    let socket
    try {
      socket = socketFactory(wsUrl)
    } catch (err) {
      connecting = false
      lastError = mapConnectionError(err)
      scheduleReconnect()
      return
    }

    ws = socket

    socket.on('open', () => {
      if (attemptId !== connectAttemptId || stopping) return
      connecting = false
      connected = true
      reconnectDelayMs = reconnectBaseDelayMs
      lastError = null
    })

    socket.on('message', (raw) => {
      let message
      try {
        message = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      if (message?.type === 'event') {
        const eventName = String(message?.eventName ?? '')
        if (!eventName) return
        updateSnapshotFromPayload(message?.payload)
        try {
          eventBus.publish(eventName, message?.payload ?? null)
        } catch {
          // Keep bridge alive if one event cannot be forwarded
        }
        return
      }

      if (message?.type !== 'response') return

      if (typeof message?.sessionId === 'string' && message.sessionId) {
        sessionId = message.sessionId
      }

      updateSnapshotFromPayload(message?.data)

      const requestId = String(message?.requestId ?? '')
      if (!requestId) {
        return
      }

      const pending = pendingByRequestId.get(requestId)
      if (!pending) return

      pendingByRequestId.delete(requestId)
      clearTimeout(pending.timeoutId)
      pending.resolve(message)
    })

    socket.on('error', (err) => {
      lastError = mapConnectionError(err)
    })

    socket.on('close', () => {
      if (attemptId !== connectAttemptId) return

      connected = false
      connecting = false
      ws = null
      sessionId = ''

      clearPendingWithError(new Error('remote runtime disconnected'))
      scheduleReconnect()
    })
  }

  function assertConnected() {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('remote runtime websocket is not connected')
    }
  }

  function sendCommand({ type, payload = {}, requestId } = {}) {
    const commandType = String(type ?? '').trim()
    if (!commandType) {
      return Promise.reject(new Error('command type is required'))
    }

    try {
      assertConnected()
    } catch (err) {
      return Promise.reject(err)
    }

    const resolvedRequestId = String(requestId ?? '').trim() || `studio-${randomUUID()}`

    return new Promise((resolveCommand, rejectCommand) => {
      const timeoutId = setTimeout(() => {
        pendingByRequestId.delete(resolvedRequestId)
        rejectCommand(new Error(`remote runtime command timed out: ${commandType}`))
      }, commandTimeoutMs)

      pendingByRequestId.set(resolvedRequestId, {
        resolve: resolveCommand,
        reject: rejectCommand,
        timeoutId,
      })

      try {
        ws.send(JSON.stringify({
          type: commandType,
          requestId: resolvedRequestId,
          payload,
        }))
      } catch (err) {
        clearTimeout(timeoutId)
        pendingByRequestId.delete(resolvedRequestId)
        rejectCommand(mapConnectionError(err))
      }
    })
  }

  async function requestSnapshot() {
    const response = await sendCommand({ type: 'snapshot', payload: {} })
    if (response?.ok !== true) {
      const message = String(response?.error?.message ?? 'remote snapshot failed')
      throw new Error(message)
    }
    updateSnapshotFromPayload(response?.data)
    return {
      running: response?.data?.running === true,
      snapshot: response?.data?.snapshot ?? null,
      workspaceDir: String(response?.data?.workspaceDir ?? cachedWorkspaceDir),
      entrypointPath: String(response?.data?.entrypointPath ?? cachedEntrypointPath),
    }
  }

  function getStatus() {
    return {
      wsUrl,
      connected,
      connecting,
      sessionId,
      remoteActive,
      workspaceDir: cachedWorkspaceDir,
      entrypointPath: cachedEntrypointPath,
      lastError: lastError ? String(lastError.message ?? lastError) : '',
    }
  }

  function getCachedSnapshot() {
    return cachedSnapshot
  }

  function disconnect() {
    stopping = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    clearPendingWithError(new Error('remote runtime bridge stopped'))

    if (ws) {
      try {
        ws.close()
      } catch {}
    }

    ws = null
    connected = false
    connecting = false
    sessionId = ''
  }

  connectInternal()

  return {
    sendCommand,
    requestSnapshot,
    getStatus,
    getCachedSnapshot,
    disconnect,
  }
}
