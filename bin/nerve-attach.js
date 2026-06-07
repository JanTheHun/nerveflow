#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

function parseHistoryQueryArgs(rest) {
  const hasFlagTokens = rest.some((token) => String(token ?? '').trim().startsWith('--'))
  if (!hasFlagTokens) {
    const limitRaw = String(rest[0] ?? '').trim()
    const targetKind = String(rest[1] ?? '').trim()
    const source = String(rest[2] ?? '').trim()
    const createdAfter = String(rest[3] ?? '').trim()
    const createdBefore = String(rest[4] ?? '').trim()
    return { limitRaw, targetKind, source, createdAfter, createdBefore }
  }

  const parsed = {
    limitRaw: '',
    targetKind: '',
    source: '',
    createdAfter: '',
    createdBefore: '',
  }
  const seenFlags = new Set()

  for (let index = 0; index < rest.length; index += 1) {
    const token = String(rest[index] ?? '').trim()
    if (!token) continue
    if (!token.startsWith('--')) {
      throw new Error('history-query does not allow positional args when flags are used')
    }

    const eqIndex = token.indexOf('=')
    const rawFlag = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2)
    const flag = String(rawFlag ?? '').trim()
    const validFlags = new Set(['limit', 'targetKind', 'source', 'createdAfter', 'createdBefore'])
    if (!validFlags.has(flag)) {
      throw new Error(`history-query received unknown flag --${flag}`)
    }
    if (seenFlags.has(flag)) {
      throw new Error(`history-query received duplicate flag --${flag}`)
    }

    let value = eqIndex >= 0 ? token.slice(eqIndex + 1).trim() : ''
    if (!value) {
      const nextToken = String(rest[index + 1] ?? '').trim()
      if (!nextToken || nextToken.startsWith('--')) {
        throw new Error(`history-query flag --${flag} requires a value`)
      }
      value = nextToken
      index += 1
    }

    seenFlags.add(flag)
    if (flag === 'limit') parsed.limitRaw = value
    else if (flag === 'targetKind') parsed.targetKind = value
    else if (flag === 'source') parsed.source = value
    else if (flag === 'createdAfter') parsed.createdAfter = value
    else if (flag === 'createdBefore') parsed.createdBefore = value
  }

  return parsed
}

function parseCliOptions(argv) {
  const [url, command, ...rest] = argv
  const wsUrl = String(url ?? '').trim()
  const cmd = String(command ?? '').trim().toLowerCase()

  if (!wsUrl || !cmd) {
    throw new Error('Usage: nerve-attach <wsUrl> <snapshot|stop|enqueue|ingress|start|listen|history-query|history-get|history-rerun> [args]')
  }

  const options = {
    wsUrl,
    command: cmd,
    commandPayload: {},
  }

  if (cmd === 'enqueue') {
    const eventType = String(rest[0] ?? '').trim()
    const value = rest.slice(1).join(' ')
    if (!eventType) throw new Error('enqueue requires <eventType> [value]')
    options.commandType = 'enqueue_event'
    options.commandPayload = { eventType, value }
  } else if (cmd === 'ingress') {
    const ingressName = String(rest[0] ?? '').trim()
    const value = rest.slice(1).join(' ')
    if (!ingressName) throw new Error('ingress requires <name> [value]')
    options.commandType = 'dispatch_ingress'
    options.commandPayload = { name: ingressName, value }
  } else if (cmd === 'start') {
    const workspaceDir = String(rest[0] ?? '').trim()
    const entrypointPath = String(rest[1] ?? '').trim()
    if (!workspaceDir) throw new Error('start requires <workspaceDir> [entrypointPath]')
    options.commandType = 'start'
    options.commandPayload = { workspaceDir }
    if (entrypointPath) options.commandPayload.entrypointPath = entrypointPath
  } else if (cmd === 'snapshot') {
    options.commandType = 'snapshot'
  } else if (cmd === 'stop') {
    options.commandType = 'stop'
  } else if (cmd === 'listen') {
    options.commandType = 'subscribe'
  } else if (cmd === 'history-query' || cmd === 'history_query') {
    const {
      limitRaw,
      targetKind,
      source,
      createdAfter,
      createdBefore,
    } = parseHistoryQueryArgs(rest)
    options.commandType = 'history_query'
    if (limitRaw) {
      const parsedLimit = Number(limitRaw)
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        throw new Error('history-query [limit] requires a positive integer when provided')
      }
      options.commandPayload.limit = parsedLimit
    }
    if (targetKind) {
      options.commandPayload.targetKind = targetKind
    }
    if (source) {
      options.commandPayload.source = source
    }
    if (createdAfter) {
      const parsedAfter = Date.parse(createdAfter)
      if (!Number.isFinite(parsedAfter)) {
        throw new Error('history-query [createdAfter] must be an ISO-8601 datetime when provided')
      }
      options.commandPayload.createdAfter = createdAfter
    }
    if (createdBefore) {
      const parsedBefore = Date.parse(createdBefore)
      if (!Number.isFinite(parsedBefore)) {
        throw new Error('history-query [createdBefore] must be an ISO-8601 datetime when provided')
      }
      options.commandPayload.createdBefore = createdBefore
    }
  } else if (cmd === 'history-get' || cmd === 'history_get') {
    const callId = String(rest[0] ?? '').trim()
    if (!callId) throw new Error('history-get requires <callId>')
    options.commandType = 'history_get'
    options.commandPayload = { callId }
  } else if (cmd === 'history-rerun' || cmd === 'history_rerun') {
    const callId = String(rest[0] ?? '').trim()
    const overridesJson = String(rest[1] ?? '').trim()
    if (!callId) throw new Error('history-rerun requires <callId> [overridesJson]')
    options.commandType = 'history_rerun'
    options.commandPayload = { callId }
    if (overridesJson) {
      let overrides
      try {
        overrides = JSON.parse(overridesJson)
      } catch {
        throw new Error('history-rerun overridesJson must be valid JSON when provided')
      }
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
        throw new Error('history-rerun overridesJson must be a JSON object when provided')
      }
      options.commandPayload.overrides = overrides
    }
  } else {
    throw new Error(`Unknown command: ${cmd}`)
  }

  return options
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', (err) => reject(err))
  })
}

async function main() {
  let options
  try {
    options = parseCliOptions(process.argv.slice(2))
  } catch (err) {
    console.error(`nerve-attach argument error: ${err?.message ?? err}`)
    process.exit(1)
  }

  let ws
  try {
    ws = await connectWebSocket(options.wsUrl)
  } catch (err) {
    console.error(`nerve-attach connection error: ${err?.message ?? err}`)
    process.exit(1)
  }

  const pending = new Map()

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw ?? '{}'))
    } catch {
      return
    }

    if (message?.type === 'event') {
      const eventName = String(message.eventName ?? '')
      const payload = message.payload
      console.log(JSON.stringify({ eventName, payload }, null, 2))
      return
    }

    if (message?.type !== 'response') return

    const requestId = String(message.requestId ?? '')
    if (!requestId) {
      // initial handshake response; ignore for one-shot command handling
      return
    }

    const resolver = pending.get(requestId)
    if (!resolver) return
    pending.delete(requestId)
    resolver(message)
  })

  if (options.command === 'listen') {
    const requestId = randomUUID()
    ws.send(JSON.stringify({
      type: 'subscribe',
      requestId,
      payload: {},
    }))

    console.log('nerve-attach subscribed. streaming events...')
    ws.on('close', () => {
      process.exit(0)
    })
    return
  }

  const requestId = randomUUID()
  const responsePromise = new Promise((resolve) => {
    pending.set(requestId, resolve)
  })

  ws.send(JSON.stringify({
    type: options.commandType,
    requestId,
    payload: options.commandPayload,
  }))

  const timeout = setTimeout(() => {
    if (pending.has(requestId)) {
      pending.delete(requestId)
      console.error('nerve-attach timed out waiting for response')
      try { ws.close() } catch {}
      process.exit(1)
    }
  }, 10000)

  const response = await responsePromise
  clearTimeout(timeout)

  console.log(JSON.stringify(response, null, 2))
  ws.close()
}

main().catch((err) => {
  console.error(`nerve-attach fatal error: ${err?.message ?? err}`)
  process.exit(1)
})
