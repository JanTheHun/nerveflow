#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const DEFAULT_TIMEOUT_MS = 30000

function parseCliOptions(argv) {
  const options = {
    message: '',
    eventType: '',
    wsUrl: '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    json: false,
    verbose: false,
    traceTools: false,
  }

  const positionals = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? '').trim()
    if (!token) continue

    if (token === '--json') {
      options.json = true
      continue
    }

    if (token === '--verbose') {
      options.verbose = true
      continue
    }

    if (token === '--trace-tools') {
      options.traceTools = true
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

  if (positionals.length < 2) {
    throw new Error('Usage: nerve-send <wsUrl> <eventType> [message] [--timeout-ms <n>] [--json] [--verbose] [--trace-tools]')
  }

  options.wsUrl = positionals[0]
  options.eventType = positionals[1]
  options.message = positionals.slice(2).join(' ')

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

function formatDisplayValue(value) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || '(empty string)'
  }

  if (value === undefined) return 'undefined'

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function extractLatestToolResultFromExecution(payload) {
  const events = Array.isArray(payload?.events) ? payload.events : []

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const runtimeEvent = events[index]
    if (!runtimeEvent || runtimeEvent.type !== 'tool_result') continue

    const toolName = String(runtimeEvent.tool ?? '').trim() || 'tool'
    const resultText = formatDisplayValue(runtimeEvent.result)
    return `${toolName}: ${resultText}`
  }

  return ''
}

function extractDisplayOutputFromExecution(payload) {
  const outputText = extractTextOutputFromExecution(payload)
  if (outputText) {
    return {
      output: outputText,
      source: 'output_text',
    }
  }

  const toolResultText = extractLatestToolResultFromExecution(payload)
  if (toolResultText) {
    return {
      output: toolResultText,
      source: 'tool_result',
    }
  }

  return {
    output: '(no output)',
    source: 'none',
  }
}

function extractExecutionEvents(payload) {
  return Array.isArray(payload?.events) ? payload.events : []
}

function buildToolTrace(events) {
  if (!Array.isArray(events) || events.length === 0) return []

  return events
    .filter((runtimeEvent) => {
      const eventType = String(runtimeEvent?.type ?? '').trim()
      return eventType === 'tool_call' || eventType === 'tool_result' || eventType === 'tool_error'
    })
    .map((runtimeEvent) => {
      const eventType = String(runtimeEvent?.type ?? '').trim()
      const schemaSource = eventType === 'tool_call' && runtimeEvent?.schemaSource
        ? String(runtimeEvent.schemaSource)
        : null
      return {
        type: eventType,
        tool: String(runtimeEvent?.tool ?? '').trim() || 'tool',
        correlationId: String(runtimeEvent?.correlationId ?? '').trim() || null,
        round: Number.isFinite(Number(runtimeEvent?.round)) ? Number(runtimeEvent.round) : null,
        status: String(runtimeEvent?.status ?? '').trim() || null,
        ...(schemaSource !== null ? { schemaSource } : {}),
        args: eventType === 'tool_call' ? (runtimeEvent?.args ?? null) : null,
        result: eventType === 'tool_result' ? (runtimeEvent?.result ?? null) : null,
        error: eventType === 'tool_error' ? (runtimeEvent?.error ?? null) : null,
      }
    })
}

function formatToolTraceLine(traceEvent) {
  const type = String(traceEvent?.type ?? '').trim()
  const tool = String(traceEvent?.tool ?? '').trim() || 'tool'
  const id = traceEvent?.correlationId ? ` id=${traceEvent.correlationId}` : ''
  const round = Number.isFinite(traceEvent?.round) ? ` round=${traceEvent.round}` : ''
  const status = traceEvent?.status ? ` status=${traceEvent.status}` : ''

  if (type === 'tool_call') {
    const schema = traceEvent?.schemaSource ? ` schema=${traceEvent.schemaSource}` : ''
    return `tool_call tool=${tool}${id}${round}${status}${schema}`
  }
  if (type === 'tool_result') {
    return `tool_result tool=${tool}${id}${round}${status}`
  }
  if (type === 'tool_error') {
    const errorMessage = String(traceEvent?.error?.message ?? '').trim()
    const code = String(traceEvent?.error?.code ?? '').trim()
    const detail = [code, errorMessage].filter(Boolean).join(': ')
    return `tool_error tool=${tool}${id}${round}${status}${detail ? ` error=${detail}` : ''}`
  }
  return `${type || 'event'} tool=${tool}${id}${round}${status}`
}

function formatExecutionErrorFromEvent(message) {
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {}
  const baseMessage = String(payload.message ?? 'Unknown nextV runtime error').trim()
  const code = String(payload.code ?? '').trim()
  const kind = String(payload.kind ?? '').trim()
  const sourcePath = String(payload.sourcePath ?? '').trim()
  const sourceLineRaw = Number(payload.sourceLine)
  const sourceLine = Number.isFinite(sourceLineRaw) && sourceLineRaw > 0 ? sourceLineRaw : null
  const statement = String(payload.statement ?? '').trim()

  const tags = [code, kind].filter(Boolean)
  const location = sourcePath
    ? (sourceLine != null ? `${sourcePath}:${sourceLine}` : sourcePath)
    : (sourceLine != null ? `line ${sourceLine}` : '')

  const detailParts = []
  if (tags.length > 0) detailParts.push(tags.join('/'))
  if (location) detailParts.push(`at ${location}`)
  if (statement) detailParts.push(`statement: ${statement}`)

  const detailText = detailParts.length > 0 ? ` (${detailParts.join(' | ')})` : ''
  const err = new Error(`${baseMessage}${detailText}`)
  err.code = code || 'runtime_error'
  err.kind = kind || ''
  return err
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
  let executionRejecter = null

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
        executionRejecter = null
        resolveExecution(message)
      }
      return
    }

    if (message?.type === 'event' && String(message.eventName ?? '') === 'nextv_error') {
      if (executionRejecter) {
        const rejectExecution = executionRejecter
        executionResolver = null
        executionRejecter = null
        rejectExecution(formatExecutionErrorFromEvent(message))
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

  const waitForExecution = () => new Promise((resolve, reject) => {
    executionResolver = resolve
    executionRejecter = reject
  })

  const timeoutError = (label) => new Error(`Timed out waiting for ${label} after ${options.timeoutMs}ms`)

  try {
    const subscribeRequestId = randomUUID()
    const subscribePromise = waitForResponse(subscribeRequestId)
    ws.send(JSON.stringify({
      type: 'subscribe',
      requestId: subscribeRequestId,
      payload: {},
    }))

    const subscribeTimeoutToken = Symbol('subscribe-timeout')
    const subscribeResponse = await Promise.race([
      subscribePromise,
      new Promise((resolve) => setTimeout(() => resolve(subscribeTimeoutToken), options.timeoutMs)),
    ])

    if (subscribeResponse !== subscribeTimeoutToken && !subscribeResponse?.ok) {
      const message = String(subscribeResponse?.error?.message ?? 'subscribe failed')
      throw new Error(message)
    }

    if (subscribeResponse === subscribeTimeoutToken) {
      // Some runtime surfaces auto-subscribe but do not always ack subscribe promptly.
      pendingResponses.delete(subscribeRequestId)
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

    const executionEvents = extractExecutionEvents(executionEvent?.payload)
    const toolTrace = buildToolTrace(executionEvents)
    const displayResult = extractDisplayOutputFromExecution(executionEvent?.payload)
    const finalText = displayResult.output

    if ((options.verbose || options.traceTools) && !options.json) {
      for (const traceEvent of toolTrace) {
        console.error(`[trace] ${formatToolTraceLine(traceEvent)}`)
      }
    }

    if (options.json) {
      const outputPayload = {
        ok: true,
        wsUrl: options.wsUrl,
        eventType: options.eventType,
        message: options.message,
        output: finalText,
        outputSource: displayResult.source,
        executionEvents,
      }
      if (options.verbose || options.traceTools) {
        outputPayload.toolTrace = toolTrace
      }
      console.log(JSON.stringify(outputPayload, null, 2))
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
