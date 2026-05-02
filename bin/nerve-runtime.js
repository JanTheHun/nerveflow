#!/usr/bin/env node
import { createServer } from 'node:http'
import { resolve } from 'node:path'

import {
  createOllamaTransport,
  createOllamaFileDebugLogger,
  createLlamaCppTransport,
  createLlamaCppFileDebugLogger,
} from '../src/host_core/agent_transports/index.js'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../src/runtime/index.js'

import {
  createEffectRealizerRuntime,
  createIngressConnectorRuntime,
  createToolRuntime,
} from '../src/host_core/index.js'

import {
  loadHostModulesByRole,
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

let options
try {
  options = parseCliOptions(process.argv.slice(2))
} catch (err) {
  console.error(`nerve-runtime argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const repoRoot = resolve(process.cwd())
const AGENT_TRANSPORT = String(process.env.AGENT_TRANSPORT ?? 'ollama').trim().toLowerCase()
const AGENT_ROUTING_DEFAULT = String(process.env.AGENT_ROUTING_DEFAULT ?? 'external').trim().toLowerCase()
const AGENT_TRANSPORT_TIMEOUT_MS_RAW = Number(process.env.AGENT_TRANSPORT_TIMEOUT_MS)
const AGENT_TRANSPORT_TIMEOUT_MS = Number.isFinite(AGENT_TRANSPORT_TIMEOUT_MS_RAW) && AGENT_TRANSPORT_TIMEOUT_MS_RAW > 0
  ? Math.floor(AGENT_TRANSPORT_TIMEOUT_MS_RAW)
  : 60000
const PARALLEL_MAX_CONCURRENCY_RAW = Number(process.env.PARALLEL_MAX_CONCURRENCY)
const PARALLEL_MAX_CONCURRENCY = Number.isFinite(PARALLEL_MAX_CONCURRENCY_RAW) && PARALLEL_MAX_CONCURRENCY_RAW > 0
  ? Math.floor(PARALLEL_MAX_CONCURRENCY_RAW)
  : null

const OLLAMA_DEBUG_LOG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_LOG ?? '').trim())
const OLLAMA_DEBUG_SUMMARY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.OLLAMA_DEBUG_SUMMARY ?? '').trim())
const OLLAMA_DEBUG_LOG_PATH = String(process.env.OLLAMA_DEBUG_LOG_PATH ?? '').trim()
  || resolve(repoRoot, 'logs', 'ollama-runtime.jsonl')

const LLAMA_CPP_DEBUG_LOG_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.LLAMA_CPP_DEBUG_LOG ?? '').trim())
const LLAMA_CPP_DEBUG_SUMMARY_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.LLAMA_CPP_DEBUG_SUMMARY ?? '').trim())
const LLAMA_CPP_DEBUG_LOG_PATH = String(process.env.LLAMA_CPP_DEBUG_LOG_PATH ?? '').trim()
  || resolve(repoRoot, 'logs', 'llama-cpp-runtime.jsonl')

let callAgent
const localCallAgent = createLlamaCppTransport({
  baseUrl: process.env.LLAMA_CPP_BASE_URL,
  timeoutMs: AGENT_TRANSPORT_TIMEOUT_MS,
  onDebugRecord: LLAMA_CPP_DEBUG_LOG_ENABLED
    ? createLlamaCppFileDebugLogger({ logPath: LLAMA_CPP_DEBUG_LOG_PATH, summarize: LLAMA_CPP_DEBUG_SUMMARY_ENABLED, source: 'nerve-runtime' })
    : null,
})

const externalCallAgent = createOllamaTransport({
  baseUrl: process.env.OLLAMA_BASE_URL,
  timeoutMs: AGENT_TRANSPORT_TIMEOUT_MS,
  onDebugRecord: OLLAMA_DEBUG_LOG_ENABLED
    ? createOllamaFileDebugLogger({ logPath: OLLAMA_DEBUG_LOG_PATH, summarize: OLLAMA_DEBUG_SUMMARY_ENABLED, source: 'nerve-runtime' })
    : null,
})

function parseModelRouteHint(modelRaw) {
  const model = String(modelRaw ?? '').trim()
  const localMatch = model.match(/^(?:local|llama(?:\.cpp)?):\s*(.+)$/i)
  if (localMatch) {
    return { route: 'local', model: localMatch[1].trim(), strategy: 'model-hint' }
  }

  const externalMatch = model.match(/^(?:external|remote|ollama):\s*(.+)$/i)
  if (externalMatch) {
    return { route: 'external', model: externalMatch[1].trim(), strategy: 'model-hint' }
  }

  return { route: '', model, strategy: '' }
}

function normalizeForcedRoute(rawTransport) {
  if (rawTransport === 'llama.cpp' || rawTransport === 'llama_cpp') return 'local'
  if (rawTransport === 'ollama') return 'external'
  if (rawTransport === 'auto' || rawTransport === 'mixed' || rawTransport === '') return ''
  return 'external'
}

const forcedRoute = normalizeForcedRoute(AGENT_TRANSPORT)

callAgent = async ({ model, messages }) => {
  const hint = parseModelRouteHint(model)
  const selectedRoute = forcedRoute || hint.route || (AGENT_ROUTING_DEFAULT === 'local' ? 'local' : 'external')
  const selectedModel = hint.model || String(model ?? '').trim()
  const strategy = forcedRoute
    ? 'forced-transport'
    : (hint.route ? hint.strategy : 'default-route')

  const transport = selectedRoute === 'local' ? localCallAgent : externalCallAgent
  const transportResult = await transport({ model: selectedModel, messages })

  if (typeof transportResult === 'string') {
    return {
      text: transportResult,
      metadata: {
        route: selectedRoute,
        strategy,
        model: selectedModel,
      },
    }
  }

  if (transportResult && typeof transportResult === 'object' && !Array.isArray(transportResult)) {
    const metadata = (transportResult.metadata && typeof transportResult.metadata === 'object' && !Array.isArray(transportResult.metadata))
      ? transportResult.metadata
      : {}
    return {
      ...transportResult,
      metadata: {
        ...metadata,
        route: selectedRoute,
        strategy,
        model: selectedModel,
      },
    }
  }

  return {
    text: String(transportResult ?? ''),
    metadata: {
      route: selectedRoute,
      strategy,
      model: selectedModel,
    },
  }
}

callAgent.capabilities = {
  routingMode: forcedRoute ? 'forced' : 'mixed',
  defaultRoute: AGENT_ROUTING_DEFAULT === 'local' ? 'local' : 'external',
  local: {
    id: 'llama.cpp',
    locality: 'local',
  },
  external: {
    id: 'ollama',
    locality: 'external',
  },
}

const DEFAULT_AGENT_MODEL = forcedRoute === 'local'
  ? (process.env.LLAMA_CPP_MODEL ?? '')
  : forcedRoute === 'external'
    ? (process.env.OLLAMA_MODEL ?? '')
    : (process.env.AGENT_DEFAULT_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.LLAMA_CPP_MODEL ?? '')

const resolvers = createRuntimeResolvers({ repoRoot })

// Load host-modules by role (builtin + public + workspace discovery)
const roles = await loadHostModulesByRole({ workspaceDir: options.workspaceDir })
const toolRuntime = createToolRuntime({ providers: roles.toolProviders })
const ingressRuntime = createIngressConnectorRuntime({ connectors: roles.ingressConnectors })
const effectRuntime = createEffectRealizerRuntime({ realizers: roles.effectRealizers })

const runtimeCore = createRuntimeCore({
  resolvers,
  callAgent,
  toolRuntime,
  ingressRuntime,
  effectRuntime,
  defaultModel: DEFAULT_AGENT_MODEL,
  parallelMaxConcurrency: PARALLEL_MAX_CONCURRENCY,
})

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

function readRequestBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('error', rejectBody)
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolveBody(text ? JSON.parse(text) : {})
      } catch {
        rejectBody(new Error('Request body must be valid JSON'))
      }
    })
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/health') {
    const status = runtimeCore.getStatus()
    sendJson(res, 200, { ok: true, mode: 'runtime', status })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/runtime/ingress') {
    if (!runtimeCore.isActive()) {
      sendJson(res, 404, { ok: false, error: 'nextV runtime not active' })
      return
    }

    let body
    try {
      body = await readRequestBody(req)
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message ?? err) })
      return
    }

    try {
      const dispatched = await runtimeCore.dispatchIngress(body)
      sendJson(res, 200, { ok: true, ...dispatched })
      return
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message ?? err) })
      return
    }
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
