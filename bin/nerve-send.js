#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const DEFAULT_WS_URL = 'ws://127.0.0.1:4190/api/runtime/ws'
const DEFAULT_TIMEOUT_MS = 10000

function parseCliOptions(argv) {
  const options = {
    message: '',
    eventType: '',
    wsUrl: DEFAULT_WS_URL,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
  }

  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? '').trim()
    if (!token) continue

    if (token === '--json') {
      options.json = true
      continue
    }

    if (token === '--event-type') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--event-type requires a value')
      options.eventType = value
      index += 1
      continue
    }

    if (token === '--ws') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--ws requires a value')
      options.wsUrl = value
      index += 1
      continue
    }

    if (token === '--timeout-ms') {
      const value = Number(argv[index + 1])
      if (!Number.isFinite(value) || value <= 0) throw new Error('--timeout-ms requires a positive number')
      options.timeoutMs = Math.floor(value)
      index += 1
      continue
    }

    if (token.startsWith('--')) {
      throw new Error(`Unknown argument: ${token}`)
    }

    positionals.push(token)
  }

  options.message = positionals.join(' ')
  if (!options.eventType) {
    throw new Error('Missing required --event-type <name>. nerve-send is channel-agnostic and does not assume a default channel.')
  }
  if (!options.wsUrl) throw new Error('--ws must be non-empty')
  return options
}

function connectWebSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    ws.once('open', () => resolve(ws))
    ws.once('error', (err) => reject(err))
  })
}

function extractTextOutputFromExecution(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : []
  const textOutputs = []

  for (const runtimeEvent of events) {
    if (!runtimeEvent || runtimeEvent.type !== 'output') continue
    const format = String(runtimeEvent.format ?? '').trim().toLowerCase()
    if (format && format !== 'text') continue

    const directText = String(runtimeEvent.text ?? '').trim()
    if (directText) {
      textOutputs.push(directText)
      continue
    }

    const valueText = String(runtimeEvent.value ?? '').trim()
    if (valueText) {
      textOutputs.push(valueText)
      continue
    }

    const payloadText = String(runtimeEvent.payload ?? '').trim()
    if (payloadText) textOutputs.push(payloadText)
  }

  if (textOutputs.length === 0) return ''
  return textOutputs[textOutputs.length - 1]
}

async function main() {
  let options
  try {
    options = parseCliOptions(process.argv.slice(2))
  } catch (err) {
    console.error(`nerve-send argument error: ${err?.message ?? err}`)
    process.exit(1)
  }

  let ws
  try {
    ws = await connectWebSocket(options.wsUrl)
  } catch (err) {
    console.error(`nerve-send connection error: ${err?.message ?? err}`)
    process.exit(1)
  }

  const pendingResponses = new Map()
  let executionResolver = null

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw ?? '{}'))
    } catch {
      return
    }

    if (message?.type === 'event' && String(message.eventName ?? '') === 'nextv_execution') {
      if (executionResolver) {
        const resolveExecution = executionResolver
        executionResolver = null
        resolveExecution(message)
      }
      return
    }

    if (message?.type !== 'response') return

    const requestId = String(message.requestId ?? '')
    if (!requestId) return

    const resolver = pendingResponses.get(requestId)
    if (!resolver) return
    pendingResponses.delete(requestId)
    resolver(message)
  })

  const waitForResponse = (requestId) => new Promise((resolve) => {
    pendingResponses.set(requestId, resolve)
  })

  const waitForExecution = () => new Promise((resolve) => {
    executionResolver = resolve
  })

  const timeoutError = (label) => {
    throw new Error(`Timed out waiting for ${label} after ${options.timeoutMs}ms`)
  }

  try {
    const subscribeRequestId = randomUUID()
    const subscribePromise = waitForResponse(subscribeRequestId)
    ws.send(JSON.stringify({
      type: 'subscribe',
      requestId: subscribeRequestId,
      payload: {},
    }))

    const subscribeResponse = await Promise.race([
      subscribePromise,
      new Promise((_, reject) => setTimeout(() => reject(timeoutError('subscribe response')), options.timeoutMs)),
    ])

    if (!subscribeResponse?.ok) {
      const message = String(subscribeResponse?.error?.message ?? 'subscribe failed')
      throw new Error(message)
    }

    const enqueueRequestId = randomUUID()
    const enqueuePromise = waitForResponse(enqueueRequestId)
    const executionPromise = waitForExecution()

    ws.send(JSON.stringify({
      type: 'enqueue_event',
      requestId: enqueueRequestId,
      payload: {
        eventType: options.eventType,
        value: options.message,
      },
    }))

    const enqueueResponse = await Promise.race([
      enqueuePromise,
      new Promise((_, reject) => setTimeout(() => reject(timeoutError('enqueue response')), options.timeoutMs)),
    ])

    if (!enqueueResponse?.ok) {
      const errorCode = String(enqueueResponse?.error?.code ?? 'runtime_error')
      const errorMessage = String(enqueueResponse?.error?.message ?? 'enqueue failed')
      if (options.json) {
        console.log(JSON.stringify({
          ok: false,
          code: errorCode,
          message: errorMessage,
        }, null, 2))
      } else {
        console.error(`nerve-send failed: ${errorMessage}`)
      }
      process.exit(1)
      return
    }

    const executionEvent = await Promise.race([
      executionPromise,
      new Promise((_, reject) => setTimeout(() => reject(timeoutError('nextv_execution event')), options.timeoutMs)),
    ])

    const outputText = extractTextOutputFromExecution(executionEvent?.payload)
    const finalText = outputText || '(no output)'

    if (options.json) {
      console.log(JSON.stringify({
        ok: true,
        wsUrl: options.wsUrl,
        eventType: options.eventType,
        message: options.message,
        output: finalText,
      }, null, 2))
    } else {
      console.log(finalText)
    }

    ws.close()
    process.exit(0)
  } catch (err) {
    console.error(`nerve-send error: ${err?.message ?? err}`)
    try { ws.close() } catch {}
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`nerve-send fatal error: ${err?.message ?? err}`)
  process.exit(1)
})
