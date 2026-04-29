import {
  buildHostProtocolResponse,
  validateHostProtocolCommand,
} from '../host_core/protocol.js'

function mapRuntimeErrorCode(errorLike) {
  const message = String(errorLike?.message ?? errorLike ?? '').toLowerCase()
  if (message.includes('not active') || message.includes('not running')) return 'not_active'
  if (message.includes('already active')) return 'already_active'
  if (message.includes('not allowed') || message.includes('policy')) return 'policy_denied'
  if (message.includes('not available')) return 'unavailable'
  if (message.includes('invalid') || message.includes('required')) return 'validation_error'
  return 'runtime_error'
}

function parseRawCommand(rawCommand) {
  if (Buffer.isBuffer(rawCommand)) {
    return JSON.parse(String(rawCommand))
  }
  if (typeof rawCommand === 'string') {
    return JSON.parse(rawCommand)
  }
  if (rawCommand && typeof rawCommand === 'object') {
    return rawCommand
  }
  throw new Error('Command must be a JSON object, string, or buffer')
}

export function createRuntimeCommandRouter({
  runtimeCore,
  sessionId,
  onSubscribe,
  onUnsubscribe,
} = {}) {
  if (!runtimeCore) {
    throw new Error('createRuntimeCommandRouter requires runtimeCore')
  }

  async function handleRawCommand(rawCommand) {
    let parsedRaw
    try {
      parsedRaw = parseRawCommand(rawCommand)
    } catch {
      return buildHostProtocolResponse({
        sessionId,
        ok: false,
        error: {
          code: 'validation_error',
          message: 'Command must be valid JSON.',
        },
        timestamp: new Date().toISOString(),
      })
    }

    let command
    try {
      command = validateHostProtocolCommand(parsedRaw)
    } catch (err) {
      return buildHostProtocolResponse({
        requestId: parsedRaw?.requestId,
        sessionId,
        ok: false,
        error: {
          code: 'validation_error',
          message: String(err?.message ?? err),
        },
        timestamp: new Date().toISOString(),
      })
    }

    try {
      const payload = command.payload ?? {}
      let data

      if (command.type === 'start') {
        data = await runtimeCore.start(payload)
      } else if (command.type === 'stop') {
        data = { snapshot: runtimeCore.stop() }
      } else if (command.type === 'enqueue_event') {
        data = runtimeCore.enqueue(payload)
      } else if (command.type === 'dispatch_ingress') {
        data = await runtimeCore.dispatchIngress(payload)
      } else if (command.type === 'snapshot') {
        const snapshot = runtimeCore.getSnapshot()
        const status = typeof runtimeCore.getStatus === 'function'
          ? (runtimeCore.getStatus() ?? {})
          : {}
        data = {
          running: snapshot?.running === true,
          snapshot,
          workspaceDir: String(status?.workspaceDir ?? ''),
          entrypointPath: String(status?.entrypointPath ?? ''),
        }
      } else if (command.type === 'subscribe') {
        if (typeof onSubscribe === 'function') onSubscribe(command)
        data = {
          subscribed: true,
          active: runtimeCore.isActive(),
        }
      } else if (command.type === 'unsubscribe') {
        if (typeof onUnsubscribe === 'function') onUnsubscribe(command)
        data = { subscribed: false }
      } else {
        throw new Error(`Unsupported command type: ${command.type}`)
      }

      return buildHostProtocolResponse({
        requestId: command.requestId,
        sessionId,
        ok: true,
        data,
        timestamp: new Date().toISOString(),
      })
    } catch (err) {
      return buildHostProtocolResponse({
        requestId: command.requestId,
        sessionId,
        ok: false,
        error: {
          code: mapRuntimeErrorCode(err),
          message: String(err?.message ?? err),
        },
        timestamp: new Date().toISOString(),
      })
    }
  }

  return {
    handleRawCommand,
  }
}
