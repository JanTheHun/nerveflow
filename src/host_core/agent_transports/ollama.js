import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Ollama chat transport adapter for nerveflow agent calls.
 *
 * @param {object}   opts
 * @param {string}   [opts.baseUrl='http://127.0.0.1:11434']
 * @param {function} [opts.onDebugRecord]  Optional debug callback(record). Must never throw.
 * @returns {function} callAgent({ model, messages })
 */
export function createOllamaTransport(opts = {}) {
  const baseUrl = String(opts.baseUrl ?? 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const onDebugRecord = typeof opts.onDebugRecord === 'function' ? opts.onDebugRecord : null
  const timeoutMsRaw = Number(opts.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.floor(timeoutMsRaw)
    : 60000

  function debug(record) {
    if (!onDebugRecord) return
    try { onDebugRecord(record) } catch { /* debug must never affect execution */ }
  }

  const callOllamaAgent = async function callOllamaAgent({ model, messages, tools, transport }) {
    const requestPayload = { model, messages: normalizeOllamaMessages(messages), stream: false }

    if (Array.isArray(tools) && tools.length > 0) {
      requestPayload.tools = tools
    }

    if (transport && typeof transport === 'object') {
      if (typeof transport.keep_alive === 'string' && transport.keep_alive.trim()) {
        requestPayload.keep_alive = transport.keep_alive.trim()
      }
      if (transport.options && typeof transport.options === 'object' && !Array.isArray(transport.options)) {
        requestPayload.options = transport.options
      }
    }

    debug({ phase: 'request', url: `${baseUrl}/api/chat`, payload: requestPayload })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    let response
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error(`Ollama chat timed out after ${timeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        debug({ phase: 'timeout', url: `${baseUrl}/api/chat`, timeoutMs })
        throw timeoutErr
      }
      debug({ phase: 'fetch_error', url: `${baseUrl}/api/chat`, error: String(err?.message ?? err) })
      throw err
    }

    debug({ phase: 'headers', url: `${baseUrl}/api/chat`, ok: response.ok, status: response.status })

    if (!response.ok) {
      let bodyText = ''
      debug({ phase: 'body_read_start', url: `${baseUrl}/api/chat`, mode: 'text', status: response.status })
      try {
        bodyText = await response.text()
      } catch (bodyErr) {
        clearTimeout(timeout)
        if (bodyErr?.name === 'AbortError') {
          const timeoutErr = new Error(`Ollama chat timed out after ${timeoutMs}ms`)
          timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
          debug({ phase: 'timeout', url: `${baseUrl}/api/chat`, timeoutMs, stage: 'body_text' })
          throw timeoutErr
        }
      }
      clearTimeout(timeout)
      debug({ phase: 'body_read_complete', url: `${baseUrl}/api/chat`, mode: 'text', status: response.status })
      debug({ phase: 'response', ok: false, status: response.status, statusText: response.statusText, bodyText })
      throw new Error(`Ollama chat failed (${response.status}): ${bodyText || response.statusText}`)
    }

    let payload
    debug({ phase: 'body_read_start', url: `${baseUrl}/api/chat`, mode: 'json', status: response.status })
    try {
      payload = await response.json()
    } catch (bodyErr) {
      clearTimeout(timeout)
      if (bodyErr?.name === 'AbortError') {
        const timeoutErr = new Error(`Ollama chat timed out after ${timeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        debug({ phase: 'timeout', url: `${baseUrl}/api/chat`, timeoutMs, stage: 'body_json' })
        throw timeoutErr
      }
      throw bodyErr
    }
    clearTimeout(timeout)
    debug({ phase: 'body_read_complete', url: `${baseUrl}/api/chat`, mode: 'json', status: response.status })
    debug({ phase: 'response', ok: true, status: response.status, payload })

    const promptTokens = Number.isFinite(Number(payload?.prompt_eval_count))
      ? Number(payload.prompt_eval_count)
      : null
    const completionTokens = Number.isFinite(Number(payload?.eval_count))
      ? Number(payload.eval_count)
      : null
    const totalTokens = (
      Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
        ? promptTokens + completionTokens
        : null
    )

    return {
      text: String(payload?.message?.content ?? payload?.response ?? '').trim(),
      metadata: {
        provider: 'ollama',
        model: String(model ?? payload?.model ?? '').trim(),
        usage: { promptTokens, completionTokens, totalTokens },
        timings: {
          totalDurationNs: Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : null,
          loadDurationNs: Number.isFinite(Number(payload?.load_duration)) ? Number(payload.load_duration) : null,
          promptEvalDurationNs: Number.isFinite(Number(payload?.prompt_eval_duration)) ? Number(payload.prompt_eval_duration) : null,
          evalDurationNs: Number.isFinite(Number(payload?.eval_duration)) ? Number(payload.eval_duration) : null,
        },
        rawProvider: {
          createdAt: String(payload?.created_at ?? ''),
          doneReason: String(payload?.done_reason ?? ''),
          prompt_eval_count: Number.isFinite(Number(payload?.prompt_eval_count)) ? Number(payload.prompt_eval_count) : null,
          eval_count: Number.isFinite(Number(payload?.eval_count)) ? Number(payload.eval_count) : null,
          prompt_eval_duration: Number.isFinite(Number(payload?.prompt_eval_duration)) ? Number(payload.prompt_eval_duration) : null,
          eval_duration: Number.isFinite(Number(payload?.eval_duration)) ? Number(payload.eval_duration) : null,
          total_duration: Number.isFinite(Number(payload?.total_duration)) ? Number(payload.total_duration) : null,
          load_duration: Number.isFinite(Number(payload?.load_duration)) ? Number(payload.load_duration) : null,
        },
        toolCalls: extractOllamaToolCalls(payload?.message?.tool_calls),
      },
    }
  }

  callOllamaAgent.capabilities = { supports_preload: true }

  callOllamaAgent.load = async function loadOllamaModel({ model: loadModel }) {
    const loadPayload = { model: loadModel, messages: [], stream: false }
    debug({ phase: 'preload_request', url: `${baseUrl}/api/chat`, model: loadModel })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loadPayload),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      debug({ phase: 'preload_error', model: loadModel, error: String(err?.message ?? err) })
      throw err
    }
    clearTimeout(timeout)
    debug({ phase: 'preload_response', ok: response.ok, status: response.status, model: loadModel })
    return { ok: response.ok, model: loadModel }
  }

  return callOllamaAgent
}

/**
 * Build an onDebugRecord callback that appends JSONL records to a file.
 *
 * @param {object}  opts
 * @param {string}  opts.logPath       Absolute path to the JSONL log file.
 * @param {boolean} [opts.summarize]   Truncate large payloads before writing.
 * @param {string}  [opts.source]      Label added to every record.
 * @returns {function} onDebugRecord(record)
 */
export function createOllamaFileDebugLogger(opts = {}) {
  const logPath = String(opts.logPath ?? '')
  const summarize = opts.summarize === true
  const source = String(opts.source ?? '').trim() || null
  if (!logPath) return () => {}

  return function onDebugRecord(record) {
    try {
      const payload = summarize ? summarizeDebugValue(record) : record
      const entry = source ? { source, ...payload } : payload
      mkdirSync(dirname(logPath), { recursive: true })
      appendFileSync(logPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, 'utf8')
    } catch { /* must never throw */ }
  }
}

// --- Internal debug helpers ---

function previewDebugText(value, maxLength = 240) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`
}

function normalizeOllamaMessages(messages) {
  if (!Array.isArray(messages)) return []

  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message

    const role = String(message.role ?? '').trim()
    if (role === 'assistant' && Array.isArray(message.tool_calls)) {
      return {
        ...message,
        tool_calls: normalizeOllamaToolCallsForRequest(message.tool_calls),
      }
    }

    if (role === 'tool') {
      return {
        role: 'tool',
        content: String(message.content ?? ''),
        tool_name: String(message.tool_name ?? message.name ?? '').trim(),
      }
    }

    return message
  })
}

function normalizeOllamaToolCallsForRequest(toolCalls) {
  if (!Array.isArray(toolCalls)) return []

  return toolCalls
    .map((toolCall) => {
      const name = String(toolCall?.function?.name ?? '').trim()
      if (!name) return null
      return {
        function: {
          name,
          arguments: normalizeOllamaToolArguments(toolCall?.function?.arguments),
        },
      }
    })
    .filter(Boolean)
}

function normalizeOllamaToolArguments(argumentsValue) {
  if (argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
    return argumentsValue
  }

  if (typeof argumentsValue === 'string' && argumentsValue.trim()) {
    try {
      const parsed = JSON.parse(argumentsValue)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed
      }
    } catch {
      return {}
    }
  }

  return {}
}

function extractOllamaToolCalls(rawToolCalls) {
  if (!Array.isArray(rawToolCalls)) return []

  return rawToolCalls
    .map((toolCall, index) => {
      let name = String(toolCall?.function?.name ?? '').trim()
      if (!name) return null
      // Strip "tool." prefix if present (some Ollama models add this prefix)
      if (name.startsWith('tool.')) {
        name = name.substring(5)
      }
      const id = String(toolCall?.id ?? `tool-call-${index + 1}`).trim() || `tool-call-${index + 1}`
      const argumentsValue = toolCall?.function?.arguments
      const argumentsRaw = typeof argumentsValue === 'string'
        ? (argumentsValue.trim() || '{}')
        : JSON.stringify(
            (argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue))
              ? argumentsValue
              : {},
          )

      return { id, name, argumentsRaw }
    })
    .filter(Boolean)
}

function summarizeDebugValue(value) {
  if (Array.isArray(value)) return value.map((entry) => summarizeDebugValue(entry))
  if (!value || typeof value !== 'object') return value

  const summary = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'messages' && Array.isArray(entry)) {
      summary.messages = entry.map((message) => {
        const base = {
          role: String(message?.role ?? ''),
          contentLength: String(message?.content ?? '').length,
          contentPreview: previewDebugText(message?.content ?? ''),
        }
        if (Array.isArray(message?.images)) {
          base.imageCount = message.images.length
          base.imageLengths = message.images.map((image) => String(image ?? '').length)
        }
        return base
      })
      continue
    }
    if (key === 'bodyText') {
      summary.bodyTextLength = String(entry ?? '').length
      summary.bodyTextPreview = previewDebugText(entry ?? '')
      continue
    }
    if (typeof entry === 'string') {
      summary[key] = entry.length > 400
        ? { length: entry.length, preview: previewDebugText(entry, 240) }
        : entry
      continue
    }
    summary[key] = summarizeDebugValue(entry)
  }
  return summary
}
