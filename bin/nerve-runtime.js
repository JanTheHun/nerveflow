#!/usr/bin/env node
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../src/runtime/index.js'

function parseCliOptions(argv) {
  const options = {
    command: '',
    workspaceDir: '',
    entrypointPath: '',
    port: 4190,
    wsPath: '/api/runtime/ws',
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
    throw new Error(`Unknown argument: ${token}`)
  }

  if (options.command !== 'start') {
    throw new Error('Usage: nerve-runtime start <workspaceDir> [--entrypoint <path>] [--port <n>] [--ws-path <path>]')
  }

  if (!options.workspaceDir) {
    throw new Error('start requires <workspaceDir>')
  }

  return options
}

async function callOllamaAgent({ model, messages }) {
  const baseUrl = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '')
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(`Ollama chat failed (${response.status}): ${bodyText || response.statusText}`)
  }

  const payload = await response.json()
  return String(payload?.message?.content ?? payload?.response ?? '').trim()
}

let options
try {
  options = parseCliOptions(process.argv.slice(2))
} catch (err) {
  console.error(`nerve-runtime argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const repoRoot = resolve(process.cwd())
const resolvers = createRuntimeResolvers({ repoRoot })
const runtimeCore = createRuntimeCore({
  resolvers,
  callAgent: callOllamaAgent,
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

try {
  await runtimeCore.start({
    workspaceDir: options.workspaceDir,
    entrypointPath: options.entrypointPath || undefined,
  })
} catch (err) {
  console.error(`nerve-runtime failed to start runtime: ${err?.message ?? err}`)
  process.exit(1)
}

server.listen(options.port, () => {
  console.log(`nerve-runtime listening at http://localhost:${options.port}`)
  console.log(`nerve-runtime websocket surface: ws://localhost:${options.port}${options.wsPath}`)
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
