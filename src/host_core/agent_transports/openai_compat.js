import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * OpenAI-compatible chat transport adapter for nerveflow agent calls.
 *
 * Works with any API that exposes a POST /v1/chat/completions endpoint
 * matching the OpenAI chat completions shape — including OpenAI, Groq,
 * Together AI, Mistral, and self-hosted OpenAI-compatible servers.
 *
 * API key is read from opts.apiKey, or from the transport config object
 * passed at call time (transport.apiKey), allowing per-agent key routing
 * via nextv.json transports.map.
 *
 * @param {object}   opts
 * @param {string}   [opts.baseUrl='https://api.openai.com']
 * @param {string}   [opts.apiKey]           Bearer token for Authorization header.
 * @param {function} [opts.onDebugRecord]    Optional debug callback(record). Must never throw.
 * @param {number}   [opts.timeoutMs=60000]
 * @returns {function} callAgent({ model, messages, transport })
 */
export function createOpenAICompatTransport(opts = {}) {
  const baseUrl = String(opts.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '')
  const staticApiKey = String(opts.apiKey ?? '').trim()
  const onDebugRecord = typeof opts.onDebugRecord === 'function' ? opts.onDebugRecord : null
  const timeoutMsRaw = Number(opts.timeoutMs)
  const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
    ? Math.floor(timeoutMsRaw)
    : 60000

  function debug(record) {
    if (!onDebugRecord) return
    try { onDebugRecord(record) } catch { /* debug must never affect execution */ }
  }

  function resolveCallTimeoutMs(transportConfig) {
    if (!transportConfig || typeof transportConfig !== 'object') {
      return timeoutMs
    }

    const rawTimeout = transportConfig.timeoutMs ?? transportConfig.timeout_ms
    const parsedTimeout = Number(rawTimeout)
    if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
      return Math.floor(parsedTimeout)
    }

    return timeoutMs
  }

  const callOpenAICompatAgent = async function callOpenAICompatAgent({ model, messages, tools, tool_choice, transport }) {
    // Per-call transport config (from nextv.json transports.map) can override API key and base URL.
    const callApiKey = String(
      (transport && typeof transport === 'object' ? transport.apiKey : null)
      ?? staticApiKey
    ).trim()
    const callBaseUrl = String(
      (transport && typeof transport === 'object' && transport.baseUrl ? transport.baseUrl : null)
      ?? baseUrl
    ).replace(/\/+$/, '')
    const callTimeoutMs = resolveCallTimeoutMs(transport)

    const url = `${callBaseUrl}/v1/chat/completions`
    const requestPayload = { model, messages, stream: false }

    // Pass through any provider-specific options declared in transport config.
    if (transport && typeof transport === 'object') {
      if (Number.isFinite(Number(transport.max_tokens)) && Number(transport.max_tokens) > 0) {
        requestPayload.max_tokens = Math.floor(Number(transport.max_tokens))
      }
      if (Number.isFinite(Number(transport.temperature))) {
        requestPayload.temperature = Number(transport.temperature)
      }
      if (typeof transport.top_p === 'number' && Number.isFinite(transport.top_p)) {
        requestPayload.top_p = transport.top_p
      }
    }

    if (Array.isArray(tools) && tools.length > 0) {
      requestPayload.tools = sanitizeToolDefinitionsForWire(tools)
      requestPayload.tool_choice = typeof tool_choice === 'string' && tool_choice.trim()
        ? tool_choice.trim()
        : 'auto'
    }

    const headers = { 'Content-Type': 'application/json' }
    if (callApiKey) {
      headers['Authorization'] = `Bearer ${callApiKey}`
    }

    debug({ phase: 'request', url, payload: requestPayload })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), callTimeoutMs)

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeout)
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error(`OpenAI-compat chat timed out after ${callTimeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        debug({ phase: 'timeout', url, timeoutMs: callTimeoutMs })
        throw timeoutErr
      }
      debug({ phase: 'fetch_error', url, error: String(err?.message ?? err) })
      throw err
    }

    debug({ phase: 'headers', url, ok: response.ok, status: response.status })

    if (!response.ok) {
      let bodyText = ''
      debug({ phase: 'body_read_start', url, mode: 'text', status: response.status })
      try {
        bodyText = await response.text()
      } catch (bodyErr) {
        clearTimeout(timeout)
        if (bodyErr?.name === 'AbortError') {
          const timeoutErr = new Error(`OpenAI-compat chat timed out after ${callTimeoutMs}ms`)
          timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
          debug({ phase: 'timeout', url, timeoutMs: callTimeoutMs, stage: 'body_text' })
          throw timeoutErr
        }
      }
      clearTimeout(timeout)
      debug({ phase: 'body_read_complete', url, mode: 'text', status: response.status })
      debug({ phase: 'response', ok: false, status: response.status, statusText: response.statusText, bodyText })
      throw new Error(`OpenAI-compat chat failed (${response.status}): ${bodyText || response.statusText}`)
    }

    let payload
    debug({ phase: 'body_read_start', url, mode: 'json', status: response.status })
    try {
      payload = await response.json()
    } catch (bodyErr) {
      clearTimeout(timeout)
      if (bodyErr?.name === 'AbortError') {
        const timeoutErr = new Error(`OpenAI-compat chat timed out after ${callTimeoutMs}ms`)
        timeoutErr.code = 'AGENT_TRANSPORT_TIMEOUT'
        debug({ phase: 'timeout', url, timeoutMs: callTimeoutMs, stage: 'body_json' })
        throw timeoutErr
      }
      throw bodyErr
    }
    clearTimeout(timeout)
    debug({ phase: 'body_read_complete', url, mode: 'json', status: response.status })
    debug({ phase: 'response', ok: true, status: response.status, payload })

    const choice = payload?.choices?.[0]
    const text = String(choice?.message?.content ?? '').trim()
    const rawToolCalls = Array.isArray(choice?.message?.tool_calls) ? choice.message.tool_calls : []
    const toolCalls = rawToolCalls
      .map((call, index) => {
        const callId = String(call?.id ?? `tool-call-${index + 1}`).trim() || `tool-call-${index + 1}`
        const callName = String(call?.function?.name ?? '').trim()
        if (!callName) return null
        const argumentsRaw = normalizeOpenAICompatToolArgumentsRaw(call?.function?.arguments)
        return {
          id: callId,
          name: callName,
          argumentsRaw,
        }
      })
      .filter(Boolean)

    const promptTokens = Number.isFinite(Number(payload?.usage?.prompt_tokens))
      ? Number(payload.usage.prompt_tokens)
      : null
    const completionTokens = Number.isFinite(Number(payload?.usage?.completion_tokens))
      ? Number(payload.usage.completion_tokens)
      : null
    const totalTokens = Number.isFinite(Number(payload?.usage?.total_tokens))
      ? Number(payload.usage.total_tokens)
      : (
        Number.isFinite(promptTokens) && Number.isFinite(completionTokens)
          ? promptTokens + completionTokens
          : null
      )

    return {
      text,
      metadata: {
        provider: 'openai_compat',
        model: String(model ?? payload?.model ?? '').trim(),
        usage: { promptTokens, completionTokens, totalTokens },
        timings: {
          promptEvalDurationNs: null,
          evalDurationNs: null,
          totalDurationNs: null,
          loadDurationNs: null,
        },
        rawProvider: {
          id: String(payload?.id ?? ''),
          object: String(payload?.object ?? ''),
          created: Number.isFinite(Number(payload?.created)) ? Number(payload.created) : null,
          finishReason: String(choice?.finish_reason ?? ''),
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
        toolCalls,
      },
    }
  }

  callOpenAICompatAgent.capabilities = { supports_preload: false }

  return callOpenAICompatAgent
}

function normalizeOpenAICompatToolArgumentsRaw(argumentsValue) {
  if (typeof argumentsValue === 'string') {
    const trimmed = argumentsValue.trim()
    return trimmed || '{}'
  }

  if (argumentsValue && typeof argumentsValue === 'object' && !Array.isArray(argumentsValue)) {
    try {
      return JSON.stringify(argumentsValue)
    } catch {
      return '{}'
    }
  }

  return '{}'
}

function sanitizeToolDefinitionsForWire(tools) {
  if (!Array.isArray(tools)) return []

  return tools
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null
      if (entry.type !== 'function') return entry

      const fn = entry.function
      if (!fn || typeof fn !== 'object' || Array.isArray(fn)) {
        return {
          ...entry,
          function: {
            name: '',
            description: '',
            parameters: { type: 'object', properties: {}, additionalProperties: true },
          },
        }
      }

      return {
        ...entry,
        function: {
          name: String(fn.name ?? '').trim(),
          description: String(fn.description ?? ''),
          parameters: (fn.parameters && typeof fn.parameters === 'object' && !Array.isArray(fn.parameters))
            ? fn.parameters
            : { type: 'object', properties: {}, additionalProperties: true },
        },
      }
    })
    .filter(Boolean)
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
export function createOpenAICompatFileDebugLogger(opts = {}) {
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

function summarizeDebugValue(value) {
  if (Array.isArray(value)) return value.map((entry) => summarizeDebugValue(entry))
  if (!value || typeof value !== 'object') return value

  const summary = {}
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'messages' && Array.isArray(entry)) {
      summary.messages = entry.map((message) => ({
        role: String(message?.role ?? ''),
        contentLength: String(message?.content ?? '').length,
        contentPreview: previewDebugText(message?.content ?? ''),
      }))
      continue
    }
    if (key === 'payload' && entry && typeof entry === 'object') {
      summary.payload = summarizeDebugValue(entry)
      continue
    }
    summary[key] = entry
  }
  return summary
}
