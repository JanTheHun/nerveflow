import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * llama.cpp chat transport adapter for nerveflow agent calls.
 *
 * llama.cpp exposes an OpenAI-compatible /v1/chat/completions endpoint.
 * Default base URL is http://127.0.0.1:8080.
 *
 * @param {object}   opts
 * @param {string}   [opts.baseUrl='http://127.0.0.1:8080']
 * @param {function} [opts.onDebugRecord]  Optional debug callback(record). Must never throw.
 * @returns {function} callAgent({ model, messages })
 */
export function createLlamaCppTransport(opts = {}) {
  const baseUrl = String(opts.baseUrl ?? 'http://127.0.0.1:8080').replace(/\/+$/, '')
  const onDebugRecord = typeof opts.onDebugRecord === 'function' ? opts.onDebugRecord : null

  function debug(record) {
    if (!onDebugRecord) return
    try { onDebugRecord(record) } catch { /* debug must never affect execution */ }
  }

  return async function callLlamaCppAgent({ model, messages }) {
    const requestPayload = { model, messages, stream: false }
    const url = `${baseUrl}/v1/chat/completions`

    debug({ phase: 'request', url, payload: requestPayload })

    let response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload),
      })
    } catch (err) {
      debug({ phase: 'fetch_error', url, error: String(err?.message ?? err) })
      throw err
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      debug({ phase: 'response', ok: false, status: response.status, statusText: response.statusText, bodyText })
      throw new Error(`llama.cpp chat failed (${response.status}): ${bodyText || response.statusText}`)
    }

    const payload = await response.json()
    debug({ phase: 'response', ok: true, status: response.status, payload })

    const choice = payload?.choices?.[0]
    const text = String(choice?.message?.content ?? '').trim()

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
        provider: 'llama.cpp',
        model: String(model ?? payload?.model ?? '').trim(),
        usage: { promptTokens, completionTokens, totalTokens },
        timings: {
          // llama.cpp may include timings_per_token in some builds; normalize to null when absent
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
      },
    }
  }
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
export function createLlamaCppFileDebugLogger(opts = {}) {
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
    if (key === 'choices' && Array.isArray(entry)) {
      summary.choices = entry.map((choice) => ({
        index: choice?.index,
        finish_reason: choice?.finish_reason,
        contentLength: String(choice?.message?.content ?? '').length,
        contentPreview: previewDebugText(choice?.message?.content ?? ''),
      }))
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
