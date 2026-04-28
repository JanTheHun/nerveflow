import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import WebSocket from 'ws'
import {
  buildPiperLaunchConfig,
  buildWhisperLaunchConfig,
  extractOutputText,
  extractTranscript,
  parseDotEnv,
  pickAudioExtension,
} from './server_lib.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const publicDir = join(__dirname, 'public')
const tempDir = join(__dirname, '.tmp')
const envPath = join(__dirname, '.env')

loadDotEnvFile(envPath)

const PORT = Number(process.env.PORT ?? 4318)
const RUNTIME_INGRESS_URL = String(process.env.RUNTIME_INGRESS_URL ?? 'http://127.0.0.1:4173/api/nextv/ingress').trim()
const RUNTIME_SSE_URL = String(process.env.RUNTIME_SSE_URL ?? 'http://127.0.0.1:4173/api/nextv/stream').trim()
const RUNTIME_WS_URL = String(process.env.RUNTIME_WS_URL ?? '').trim() || inferRuntimeWsUrl()
const VOICE_INGRESS_NAME = String(process.env.VOICE_INGRESS_NAME ?? 'user_message').trim() || 'user_message'
const VOICE_OUTPUT_CHANNEL = String(process.env.VOICE_OUTPUT_CHANNEL ?? 'json').trim() || 'json'
const VOICE_TRANSPORT_MODE = normalizeTransportMode(process.env.VOICE_TRANSPORT_MODE)
const MAX_AUDIO_BYTES = Math.max(1024, Number(process.env.VOICE_MAX_AUDIO_BYTES ?? 10 * 1024 * 1024) || (10 * 1024 * 1024))
const RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.VOICE_RATE_LIMIT_WINDOW_MS ?? 60000) || 60000)
const RATE_LIMIT_MAX_REQUESTS = Math.max(1, Number(process.env.VOICE_RATE_LIMIT_MAX_REQUESTS ?? 12) || 12)

let wsTransportEnabled = VOICE_TRANSPORT_MODE !== 'http-only' && Boolean(RUNTIME_WS_URL)
let activeTransport = wsTransportEnabled ? 'ws' : 'http'
const rateLimitState = new Map()

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function loadDotEnvFile(path) {
  if (!existsSync(path)) return
  const parsed = parseDotEnv(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null) {
      process.env[key] = value
    }
  }
}

function inferRuntimeWsUrl() {
  const candidates = [RUNTIME_INGRESS_URL, RUNTIME_SSE_URL]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      const isSecure = url.protocol === 'https:'
      url.protocol = isSecure ? 'wss:' : 'ws:'
      if (url.pathname.endsWith('/api/nextv/ingress') || url.pathname.endsWith('/api/nextv/stream')) {
        url.pathname = '/api/nextv/ws'
        url.search = ''
        return url.toString()
      }
      if (url.pathname.endsWith('/api/runtime/ingress') || url.pathname.endsWith('/api/runtime/stream')) {
        url.pathname = '/api/runtime/ws'
        url.search = ''
        return url.toString()
      }
    } catch {
      // ignore invalid URL candidates
    }
  }
  return ''
}

function normalizeTransportMode(rawValue) {
  const normalized = String(rawValue ?? 'ws-fallback').trim().toLowerCase()
  if (normalized === 'ws-only') return 'ws-only'
  if (normalized === 'http-only') return 'http-only'
  return 'ws-fallback'
}

function createVoiceError(code, message, options = {}) {
  const err = new Error(String(message ?? code ?? 'voice_spa_error'))
  err.code = String(code ?? 'voice_spa_error')
  err.statusCode = Number.isInteger(options.statusCode) ? options.statusCode : 500
  err.retryable = options.retryable === true
  err.stage = String(options.stage ?? '').trim() || 'runtime'
  err.details = options.details && typeof options.details === 'object' ? options.details : undefined
  return err
}

function normalizeErrorPayload(error, fallbackCode = 'voice_spa_error', fallbackMessage = 'Voice server error') {
  const code = String(error?.code ?? fallbackCode)
  const message = String(error?.message ?? fallbackMessage)
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500
  const retryable = error?.retryable === true
  const stage = String(error?.stage ?? 'runtime')
  const details = error?.details && typeof error.details === 'object' ? error.details : undefined
  return { code, message, statusCode, retryable, stage, details }
}

function sendErrorJson(res, error, fallbackCode, fallbackMessage) {
  const normalized = normalizeErrorPayload(error, fallbackCode, fallbackMessage)
  const payload = {
    ok: false,
    error: normalized.message,
    code: normalized.code,
    retryable: normalized.retryable,
    stage: normalized.stage,
    transportMode: activeTransport,
  }
  if (normalized.details) payload.details = normalized.details
  sendJson(res, normalized.statusCode, payload)
}

function isConfiguredFile(pathLike) {
  const pathValue = String(pathLike ?? '').trim()
  if (!pathValue) return false
  return existsSync(pathValue)
}

function getRequestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] ?? '').trim()
  if (forwarded) return forwarded.split(',')[0].trim()
  return String(req?.socket?.remoteAddress ?? 'unknown')
}

function enforceRateLimit(req) {
  const now = Date.now()
  const ip = getRequestIp(req)
  const existing = rateLimitState.get(ip)
  if (!existing || now >= existing.resetAt) {
    rateLimitState.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return
  }
  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw createVoiceError(
      'rate_limited',
      'Too many voice requests. Please retry shortly.',
      {
        statusCode: 429,
        retryable: true,
        stage: 'ingress',
        details: { retryAfterMs: Math.max(0, existing.resetAt - now) },
      },
    )
  }
  existing.count += 1
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function sendFile(res, filePath) {
  if (!existsSync(filePath)) {
    sendJson(res, 404, { ok: false, error: 'Not found' })
    return
  }

  const extension = extname(filePath).toLowerCase()
  const contentType = CONTENT_TYPES[extension] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  res.end(readFileSync(filePath))
}

function readRequestBody(req, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : MAX_AUDIO_BYTES
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let totalBytes = 0
    let done = false
    req.on('data', (chunk) => {
      if (done) return
      totalBytes += chunk.length
      if (totalBytes > maxBytes) {
        done = true
        rejectBody(createVoiceError(
          'audio_payload_too_large',
          `Audio payload exceeds limit (${maxBytes} bytes).`,
          { statusCode: 413, retryable: false, stage: 'ingress' },
        ))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (done) return
      done = true
      resolveBody(Buffer.concat(chunks))
    })
    req.on('error', (error) => {
      if (done) return
      done = true
      rejectBody(error)
    })
  })
}

function assertWhisperPathExists() {
  const whisperPath = String(process.env.WHISPER_RUN_PATH ?? '').trim()
  if (!whisperPath) {
    throw new Error('WHISPER_RUN_PATH is not configured in voice-spa/.env')
  }
  if (!existsSync(whisperPath)) {
    throw new Error(`WHISPER_RUN_PATH does not exist: ${whisperPath}`)
  }
  const stats = statSync(whisperPath)
  if (!stats.isFile()) {
    throw new Error(`WHISPER_RUN_PATH must point to a file: ${whisperPath}`)
  }
}

function transcribeAudio(inputPath) {
  assertWhisperPathExists()
  const outputPath = inputPath.replace(/\.[^.]+$/, '')
  const launchConfig = buildWhisperLaunchConfig(process.env, inputPath, outputPath)

  return new Promise((resolveTranscription, rejectTranscription) => {
    const child = spawn(launchConfig.command, launchConfig.args, {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      rejectTranscription(new Error(`Failed to start Whisper runner: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code !== 0) {
        rejectTranscription(new Error(`Whisper runner exited with status ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
        return
      }
      
      const jsonPath = `${outputPath}.json`
      if (!existsSync(jsonPath)) {
        const hint = stderr.trim() || stdout.trim()
        rejectTranscription(new Error(`Whisper JSON output file not found at ${jsonPath}${hint ? `\n${hint}` : ''}`))
        return
      }

      try {
        const jsonContent = readFileSync(jsonPath, 'utf8')
        const parsed = JSON.parse(jsonContent)
        const transcript = extractTranscript(parsed)
        if (!transcript) {
          rejectTranscription(new Error('Whisper runner produced no transcript output'))
          return
        }
        resolveTranscription({ transcript, parsed })
      } catch (error) {
        rejectTranscription(new Error(`Failed to parse Whisper JSON output: ${error.message}`))
      }
    })
  })
}

async function dispatchIngress(text) {
  if (wsTransportEnabled) {
    try {
      activeTransport = 'ws'
      return await dispatchIngressViaWs(text)
    } catch (err) {
      if (VOICE_TRANSPORT_MODE === 'ws-only') {
        throw createVoiceError(
          'runtime_ws_unavailable',
          `WS dispatch failed in ws-only mode: ${String(err?.message ?? err)}`,
          { statusCode: 502, retryable: true, stage: 'dispatch' },
        )
      }
      console.warn('[voice-spa] ws dispatch failed; falling back to HTTP ingress:', String(err?.message ?? err))
      wsTransportEnabled = false
      activeTransport = 'http'
    }
  }

  if (!RUNTIME_INGRESS_URL) {
    throw new Error('RUNTIME_INGRESS_URL is not configured in voice-spa/.env')
  }

  activeTransport = 'http'
  const response = await fetch(RUNTIME_INGRESS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: VOICE_INGRESS_NAME,
      value: text,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw createVoiceError(
      'runtime_ingress_failed',
      payload.error ?? `Ingress dispatch failed with status ${response.status}`,
      { statusCode: 502, retryable: true, stage: 'dispatch' },
    )
  }

  return payload
}

function openRuntimeWs() {
  if (!RUNTIME_WS_URL) {
    throw new Error('RUNTIME_WS_URL is not configured and could not be inferred from HTTP endpoints')
  }
  return new Promise((resolveWs, rejectWs) => {
    const ws = new WebSocket(RUNTIME_WS_URL)
    const onOpen = () => {
      ws.off('error', onError)
      resolveWs(ws)
    }
    const onError = (err) => {
      ws.off('open', onOpen)
      rejectWs(err)
    }
    ws.once('open', onOpen)
    ws.once('error', onError)
  })
}

function parseWsJson(raw) {
  try {
    return JSON.parse(String(raw ?? '{}'))
  } catch {
    return null
  }
}

async function dispatchIngressViaWs(text) {
  const ws = await openRuntimeWs()
  const requestId = randomUUID()

  return await new Promise((resolveDispatch, rejectDispatch) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectDispatch(new Error('dispatch_ingress timed out waiting for ws response'))
    }, 10000)

    const cleanup = () => {
      clearTimeout(timeout)
      ws.removeAllListeners('message')
      ws.removeAllListeners('close')
      ws.removeAllListeners('error')
      try { ws.close() } catch { /* ignore */ }
    }

    ws.on('error', (err) => {
      cleanup()
      rejectDispatch(new Error(`runtime ws error: ${String(err?.message ?? err)}`))
    })

    ws.on('close', () => {
      cleanup()
      rejectDispatch(new Error('runtime ws closed before dispatch response'))
    })

    ws.on('message', (raw) => {
      const message = parseWsJson(raw)
      if (!message || message.type !== 'response') return
      const incomingRequestId = String(message.requestId ?? '')
      if (!incomingRequestId || incomingRequestId !== requestId) return

      if (message.ok !== true) {
        const errorText = String(message?.error?.message ?? 'dispatch_ingress failed')
        cleanup()
        rejectDispatch(new Error(errorText))
        return
      }

      const data = message?.data && typeof message.data === 'object' ? message.data : {}
      cleanup()
      resolveDispatch(data)
    })

    ws.send(JSON.stringify({
      type: 'dispatch_ingress',
      requestId,
      payload: {
        name: VOICE_INGRESS_NAME,
        value: text,
      },
    }))
  })
}

async function* parseSSEStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let current = { type: 'message', data: '' }
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trimEnd()
        if (trimmed.startsWith('event:')) {
          current.type = trimmed.slice(6).trim()
        } else if (trimmed.startsWith('data:')) {
          current.data += (current.data ? '\n' : '') + trimmed.slice(5).trim()
        } else if (trimmed === '') {
          if (current.data) yield { ...current }
          current = { type: 'message', data: '' }
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

function synthesizeSpeech(text) {
  const piperPath = String(process.env.PIPER_RUN_PATH ?? '').trim()
  if (!piperPath) throw new Error('PIPER_RUN_PATH is not configured in voice-spa/.env')
  if (!existsSync(piperPath)) throw new Error(`PIPER_RUN_PATH does not exist: ${piperPath}`)

  mkdirSync(tempDir, { recursive: true })
  const outputPath = join(tempDir, `tts-${Date.now()}-${randomUUID().slice(0, 8)}.wav`)
  const launchConfig = buildPiperLaunchConfig(process.env, outputPath)

  return new Promise((resolveSynth, rejectSynth) => {
    const child = spawn(launchConfig.command, launchConfig.args, {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    child.stdin.write(text)
    child.stdin.end()
    child.on('error', (err) => rejectSynth(new Error(`Failed to start Piper: ${err.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        rejectSynth(new Error(`Piper exited with status ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
        return
      }
      if (!existsSync(outputPath)) {
        rejectSynth(new Error('Piper did not produce output file'))
        return
      }
      try {
        const audio = readFileSync(outputPath)
        resolveSynth(audio)
      } catch (err) {
        rejectSynth(err)
      } finally {
        try { rmSync(outputPath, { force: true }) } catch { /* ignore */ }
      }
    })
  })
}

async function handleOutputSSEStream(req, res) {
  if (wsTransportEnabled) {
    try {
      await handleOutputWsStream(req, res)
      return
    } catch (err) {
      if (VOICE_TRANSPORT_MODE === 'ws-only') {
        throw createVoiceError(
          'runtime_ws_stream_unavailable',
          `WS output stream failed in ws-only mode: ${String(err?.message ?? err)}`,
          { statusCode: 502, retryable: true, stage: 'stream' },
        )
      }
      console.warn('[voice-spa] ws output stream failed; falling back to HTTP SSE:', String(err?.message ?? err))
      wsTransportEnabled = false
      activeTransport = 'http'
    }
  }

  await handleOutputHttpStream(req, res)
}

async function handleOutputHttpStream(req, res) {
  activeTransport = 'http'
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
  })
  res.flushHeaders()

  const controller = new AbortController()
  req.on('close', () => controller.abort())

  let runtimeResponse
  try {
    runtimeResponse = await fetch(RUNTIME_SSE_URL, { signal: controller.signal })
  } catch (err) {
    if (!controller.signal.aborted) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`)
    }
    res.end()
    return
  }

  res.write('event: stream_open\ndata: {}\n\n')

  try {
    for await (const sseEvent of parseSSEStream(runtimeResponse)) {
      if (controller.signal.aborted) break
      if (sseEvent.type !== 'nextv_runtime_event') continue

      let payload
      try { payload = JSON.parse(sseEvent.data) } catch { continue }
      const runtimeEvent = payload?.runtimeEvent
      if (runtimeEvent?.type !== 'output') continue
      if (String(runtimeEvent?.format ?? '').trim() !== VOICE_OUTPUT_CHANNEL) continue

      const text = extractOutputText(payload)
      if (!text) continue

      console.log('[piper] synthesizing:', text)
      try {
        const audioBuffer = await synthesizeSpeech(text)
        const audioBase64 = audioBuffer.toString('base64')
        res.write(`event: voice_output\ndata: ${JSON.stringify({ text, audioBase64 })}\n\n`)
      } catch (err) {
        console.error('[piper error]', err.message)
        res.write(`event: voice_output\ndata: ${JSON.stringify({ text, error: err.message })}\n\n`)
      }
    }
  } catch (err) {
    if (!controller.signal.aborted) console.error('[output stream error]', err.message)
  }

  res.end()
}

async function handleOutputWsStream(req, res) {
  activeTransport = 'ws'
  const ws = await openRuntimeWs()

  const subscribeRequestId = randomUUID()
  await new Promise((resolveSubscribe, rejectSubscribe) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectSubscribe(new Error('subscribe timed out'))
    }, 10000)

    const onError = (err) => {
      cleanup()
      rejectSubscribe(new Error(String(err?.message ?? err)))
    }

    const onClose = () => {
      cleanup()
      rejectSubscribe(new Error('runtime ws closed before subscribe response'))
    }

    const onMessage = (raw) => {
      const message = parseWsJson(raw)
      if (!message || message.type !== 'response') return
      const requestId = String(message.requestId ?? '')
      if (!requestId || requestId !== subscribeRequestId) return

      if (message.ok !== true) {
        const errorText = String(message?.error?.message ?? 'subscribe failed')
        cleanup()
        rejectSubscribe(new Error(errorText))
        return
      }

      cleanup()
      resolveSubscribe()
    }

    function cleanup() {
      clearTimeout(timeout)
      ws.off('error', onError)
      ws.off('close', onClose)
      ws.off('message', onMessage)
    }

    ws.on('error', onError)
    ws.on('close', onClose)
    ws.on('message', onMessage)

    ws.send(JSON.stringify({
      type: 'subscribe',
      requestId: subscribeRequestId,
      payload: {},
    }))
  })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
  })
  res.flushHeaders()
  res.write('event: stream_open\ndata: {}\n\n')

  const closeAll = () => {
    try { ws.close() } catch { /* ignore */ }
    res.end()
  }

  req.on('close', () => {
    try { ws.close() } catch { /* ignore */ }
  })

  ws.on('error', (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: String(err?.message ?? err) })}\n\n`)
    closeAll()
  })

  ws.on('close', () => {
    closeAll()
  })

  ws.on('message', async (raw) => {
    const message = parseWsJson(raw)
    if (!message || typeof message !== 'object') return

    if (message.type === 'response') return

    if (message.type !== 'event') return
    if (String(message.eventName ?? '') !== 'nextv_runtime_event') return

    const payload = message.payload
    const runtimeEvent = payload?.runtimeEvent
    if (runtimeEvent?.type !== 'output') return
    if (String(runtimeEvent?.format ?? '').trim() !== VOICE_OUTPUT_CHANNEL) return

    const text = extractOutputText(payload)
    if (!text) return

    console.log('[piper] synthesizing:', text)
    try {
      const audioBuffer = await synthesizeSpeech(text)
      const audioBase64 = audioBuffer.toString('base64')
      res.write(`event: voice_output\ndata: ${JSON.stringify({ text, audioBase64 })}\n\n`)
    } catch (err) {
      console.error('[piper error]', err.message)
      res.write(`event: voice_output\ndata: ${JSON.stringify({ text, error: err.message })}\n\n`)
    }
  })
}

async function handleVoiceCommand(req, res) {
  enforceRateLimit(req)

  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!contentType.startsWith('audio/')) {
    throw createVoiceError(
      'invalid_audio_content_type',
      'Expected an audio/* content-type payload.',
      { statusCode: 415, retryable: false, stage: 'ingress' },
    )
  }

  const body = await readRequestBody(req, { maxBytes: MAX_AUDIO_BYTES })
  if (body.length === 0) {
    throw createVoiceError(
      'empty_audio_payload',
      'Audio payload is empty.',
      { statusCode: 400, retryable: false, stage: 'ingress' },
    )
  }

  mkdirSync(tempDir, { recursive: true })
  const extension = pickAudioExtension(req.headers['content-type'])
  const inputPath = join(tempDir, `voice-${Date.now()}-${randomUUID().slice(0, 8)}${extension}`)

  try {
    writeFileSync(inputPath, body)
    const { transcript, parsed } = await transcribeAudio(inputPath)
    console.log('[whisper response]', parsed)
    const runtime = await dispatchIngress(transcript)
    sendJson(res, 200, {
      ok: true,
      transcript,
      ingressName: VOICE_INGRESS_NAME,
      runtime,
    })
  } catch (error) {
    sendErrorJson(res, error, 'voice_command_failed', 'Voice command failed')
  } finally {
    try {
      rmSync(inputPath, { force: true })
    } catch {
      // Ignore temp cleanup failures.
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        ingressName: VOICE_INGRESS_NAME,
        outputChannel: VOICE_OUTPUT_CHANNEL,
        transportMode: activeTransport,
        transportPolicy: VOICE_TRANSPORT_MODE,
        runtime: {
          wsUrl: RUNTIME_WS_URL || null,
          ingressUrl: RUNTIME_INGRESS_URL || null,
          sseUrl: RUNTIME_SSE_URL || null,
          wsConfigured: Boolean(RUNTIME_WS_URL),
          ingressConfigured: Boolean(RUNTIME_INGRESS_URL),
          sseConfigured: Boolean(RUNTIME_SSE_URL),
        },
        limits: {
          maxAudioBytes: MAX_AUDIO_BYTES,
          rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
          rateLimitMaxRequests: RATE_LIMIT_MAX_REQUESTS,
        },
        dependencies: {
          whisperConfigured: isConfiguredFile(process.env.WHISPER_RUN_PATH),
          piperConfigured: isConfiguredFile(process.env.PIPER_RUN_PATH),
        },
      })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/voice-command') {
      try {
        await handleVoiceCommand(req, res)
      } catch (error) {
        sendErrorJson(res, error, 'voice_command_failed', 'Voice command failed')
      }
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/output/stream') {
      try {
        await handleOutputSSEStream(req, res)
      } catch (error) {
        const normalized = normalizeErrorPayload(error, 'voice_stream_failed', 'Voice output stream failed')
        res.writeHead(normalized.statusCode, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          'Connection': 'keep-alive',
        })
        res.end(`event: error\ndata: ${JSON.stringify({ error: normalized.message, code: normalized.code, retryable: normalized.retryable, stage: normalized.stage })}\n\n`)
      }
      return
    }

    if (req.method === 'GET') {
      const relativePath = url.pathname === '/' ? '/index.html' : url.pathname
      const filePath = resolve(publicDir, `.${relativePath}`)
      if (!filePath.startsWith(publicDir)) {
        sendJson(res, 403, { ok: false, error: 'Forbidden' })
        return
      }
      sendFile(res, filePath)
      return
    }

    sendJson(res, 404, { ok: false, error: 'Not found', code: 'not_found' })
  } catch (error) {
    sendErrorJson(res, error, 'voice_server_unexpected_error', 'Unexpected server error')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`news-agent voice SPA listening on http://127.0.0.1:${PORT}`)
  console.log('[voice-spa] transport policy:', VOICE_TRANSPORT_MODE)
  console.log('[voice-spa] active transport:', activeTransport)
  console.log('[voice-spa] runtime ws configured:', Boolean(RUNTIME_WS_URL))
  if (VOICE_TRANSPORT_MODE === 'ws-only' && !RUNTIME_WS_URL) {
    console.warn('[voice-spa] ws-only mode is enabled but no runtime ws url is configured')
  }
})