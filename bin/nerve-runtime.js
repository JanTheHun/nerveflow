#!/usr/bin/env node
import { createServer } from 'node:http'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../src/runtime/index.js'

import {
  createToolRuntime,
} from '../src/host_core/index.js'

import {
  loadHostModules,
} from '../src/host_modules/index.js'

function parseCliOptions(argv) {
  const options = {
    command: '',
    workspaceDir: '',
    entrypointPath: '',
    port: 4190,
    wsPath: '/api/runtime/ws',
    autoStart: true,
  }

  const [command, maybeWorkspace] = argv
  if (command === 'start') {
    options.command = 'start'
    options.workspaceDir = String(maybeWorkspace ?? '').trim()
  }

  for (let index = 2; index < argv.length; index += 1) {
    const token = String(argv[index] ?? '').trim()
    if (token === '--entrypoint') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--entrypoint requires a value')
      options.entrypointPath = value
      index += 1
      continue
    }
    if (token === '--port') {
      const value = Number(argv[index + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--port requires a positive integer')
      options.port = value
      index += 1
      continue
    }
    if (token === '--ws-path') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--ws-path requires a value')
      options.wsPath = value.startsWith('/') ? value : `/${value}`
      index += 1
      continue
    }
    if (token === '--no-autostart') {
      options.autoStart = false
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  if (options.command !== 'start') {
    throw new Error('Usage: nerve-runtime start <workspaceDir> [--entrypoint <path>] [--port <n>] [--ws-path <path>] [--no-autostart]')
  }

  if (!options.workspaceDir) {
    throw new Error('start requires <workspaceDir>')
  }

  return options
}

async function callOllamaAgent({ model, messages }) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const requestPayload = {
    model,
    messages,
    stream: false,
  }

  appendOllamaDebugRecord({
    source: 'nerve-runtime',
    phase: 'request',
    url: `${baseUrl}/api/chat`,
    payload: requestPayload,
  })

  let response
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    })
  } catch (err) {
    appendOllamaDebugRecord({
      source: 'nerve-runtime',
      phase: 'fetch_error',
      url: `${baseUrl}/api/chat`,
      error: String(err?.message ?? err),
    })
    throw err
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    appendOllamaDebugRecord({
      source: 'nerve-runtime',
      phase: 'response',
      ok: false,
      status: response.status,
      statusText: response.statusText,
      bodyText,
    })
    throw new Error(`Ollama chat failed (${response.status}): ${bodyText || response.statusText}`)
  }

  const payload = await response.json()
  appendOllamaDebugRecord({
    source: 'nerve-runtime',
    phase: 'response',
    ok: true,
    status: response.status,
    payload,
  })
  return String(payload?.message?.content ?? payload?.response ?? '').trim()
}

function previewDebugText(value, maxLength = 240) {
  const text = String(value ?? '')
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}...`
}

function summarizeDebugValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => summarizeDebugValue(entry))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

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

let options
try {
  options = parseCliOptions(process.argv.slice(2))
} catch (err) {
  console.error(`nerve-runtime argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const repoRoot = resolve(process.cwd())
const OLLAMA_DEBUG_LOG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_LOG ?? '').trim())
const OLLAMA_DEBUG_SUMMARY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_SUMMARY ?? '').trim())
const OLLAMA_DEBUG_LOG_PATH = String(process.env.OLLAMA_DEBUG_LOG_PATH ?? '').trim()
  || resolve(repoRoot, 'logs', 'ollama-runtime.jsonl')

function appendOllamaDebugRecord(record) {
  if (!OLLAMA_DEBUG_LOG_ENABLED) return
  try {
    const payload = OLLAMA_DEBUG_SUMMARY_ENABLED
      ? summarizeDebugValue(record)
      : record
    mkdirSync(dirname(OLLAMA_DEBUG_LOG_PATH), { recursive: true })
    appendFileSync(OLLAMA_DEBUG_LOG_PATH, `${JSON.stringify({ timestamp: new Date().toISOString(), ...payload })}\n`, 'utf8')
  } catch {
    // Debug logging must never break runtime agent calls.
  }
}

const resolvers = createRuntimeResolvers({ repoRoot })

// Load host-modules providers (builtin + workspace discovery)
const providers = await loadHostModules({ workspaceDir: options.workspaceDir })
const toolRuntime = createToolRuntime({ providers })

const runtimeCore = createRuntimeCore({
  resolvers,
  callAgent: callOllamaAgent,
  toolRuntime,
  defaultModel: process.env.OLLAMA_MODEL ?? '',
})

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    const status = runtimeCore.getStatus()
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: true, mode: 'runtime', status }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not Found')
})

const wsSurface = createRuntimeWebSocketSurface({
  server,
  runtimeCore,
  path: options.wsPath,
})

if (options.autoStart) {
  try {
    await runtimeCore.start({
      workspaceDir: options.workspaceDir,
      entrypointPath: options.entrypointPath || undefined,
    })
  } catch (err) {
    console.error(`nerve-runtime failed to start runtime: ${err?.message ?? err}`)
    process.exit(1)
  }
}

server.listen(options.port, () => {
  console.log(`nerve-runtime listening at http://localhost:${options.port}`)
  console.log(`nerve-runtime websocket surface: ws://localhost:${options.port}${options.wsPath}`)
  if (!options.autoStart) {
    console.log('nerve-runtime autostart disabled; waiting for remote start command')
  }
})

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`nerve-runtime received ${signal}, shutting down...`)

  try {
    wsSurface.close()
  } catch {}

  try {
    runtimeCore.shutdown()
  } catch {}

  server.close(() => {
    process.exit(0)
  })
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
