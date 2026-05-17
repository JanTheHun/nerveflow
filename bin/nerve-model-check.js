#!/usr/bin/env node
/**
 * nerve-model-check — preflight validation + optional runtime smoke test.
 *
 * Validates that the configured agent transport (Ollama or llama.cpp) is
 * reachable, checks that a specific model is available, and optionally runs
 * a direct chat ping (--ping) or a full runtime smoke test (--smoke).
 *
 * Usage:
 *   nerve-model-check [<model>] [--transport ollama|llama.cpp] [--base-url <url>]
 *                     [--model <name>] [--ping] [--smoke]
 *                     [--smoke-port <n>] [--smoke-timeout-ms <n>]
 *                     [--preflight-timeout-ms <n>]
 *
 * Model can be passed as a bare positional argument or via --model:
 *   npm run model:check phi3:mini-128k
 *   npm run model:check -- --model phi3:mini-128k --smoke
 *
 * Environment variables (read when no CLI flags override):
 *   AGENT_TRANSPORT    ollama (default) | llama.cpp
 *   OLLAMA_BASE_URL    default: http://127.0.0.1:11434
 *   LLAMA_CPP_BASE_URL default: http://127.0.0.1:8080
 *   OLLAMA_MODEL       model name used when --model is not set
 *   LLAMA_CPP_MODEL    model name used when --model is not set for llama.cpp
 *   MODEL_CHECK_PREFLIGHT_TIMEOUT_MS timeout for preflight checks (default: 15000)
 *
 * Exit codes:
 *   0 — all required checks passed
 *   1 — one or more required checks failed
 */

// Self-contained for preflight; imports ws + node:* only when --smoke is used.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434'
const DEFAULT_LLAMA_CPP_BASE_URL = 'http://127.0.0.1:8080'

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseCliOptions(argv) {
  const options = {
    transport: null,
    baseUrl: null,
    model: null,
    ping: false,
    smoke: false,
    smokePort: 4297,
    smokeTimeoutMs: 45000,
    preflightTimeoutMs: 15000,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '').trim()
    if (!token) continue

    if (token === '--ping') { options.ping = true; continue }
    if (token === '--smoke') { options.smoke = true; continue }

    if (['--transport', '--base-url', '--model', '--smoke-port', '--smoke-timeout-ms', '--preflight-timeout-ms'].includes(token)) {
      const value = String(argv[i + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`)
      switch (token) {
        case '--transport':        options.transport = value.toLowerCase(); break
        case '--base-url':         options.baseUrl = value; break
        case '--model':            options.model = value; break
        case '--smoke-port':       options.smokePort = Number(value); break
        case '--smoke-timeout-ms': options.smokeTimeoutMs = Number(value); break
        case '--preflight-timeout-ms': options.preflightTimeoutMs = Number(value); break
      }
      i += 1
      continue
    }

    // Bare positional argument → model name.
    if (!token.startsWith('-')) {
      if (options.model) throw new Error(`Unexpected extra argument: ${token}`)
      options.model = token
      continue
    }

    throw new Error(`Unknown argument: ${token}`)
  }
  return options
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function pass(msg) { console.log(`✅ ${msg}`) }
function fail(msg) { console.log(`❌ ${msg}`) }
function warn(msg) { console.log(`⚠️  ${msg}`) }
function hint(msg) { console.log(`    ${msg}`) }
function section(msg) { console.log(`\n${msg}`) }

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  if (typeof timeout?.unref === 'function') timeout.unref()
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error(`request timed out after ${timeoutMs}ms`)
      timeoutErr.code = 'MODEL_CHECK_TIMEOUT'
      throw timeoutErr
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

async function runPreflightChecks({ transport, baseUrl, model }) {
  const isOllama   = transport === 'ollama'
  const isLlamaCpp = transport === 'llama.cpp' || transport === 'llama_cpp'
  const transportLabel = isOllama ? 'Ollama' : 'llama.cpp'

  let allOk = true
  let reachable = false
  let modelList = null  // string[] | null

  // Check 1: Node.js >= 18
  const nodeMajor = Number(String(process.versions.node).split('.')[0])
  if (nodeMajor >= 18) {
    pass(`Node.js ${process.versions.node} (>= 18 required)`)
  } else {
    fail(`Node.js ${process.versions.node} is below the required minimum of 18`)
    allOk = false
  }

  // Check 2: Endpoint reachable
  const primaryUrl  = isOllama ? `${baseUrl}/api/tags` : `${baseUrl}/v1/models`
  const fallbackUrl = isLlamaCpp ? `${baseUrl}/health` : null

  try {
    const res = await fetch(primaryUrl)
    if (res.ok) {
      reachable = true
      const body = await res.json().catch(() => null)
      if (isOllama && Array.isArray(body?.models)) {
        modelList = body.models.map((m) => String(m?.name ?? m?.model ?? m))
      } else if (isLlamaCpp && Array.isArray(body?.data)) {
        modelList = body.data.map((m) => String(m?.id ?? m))
      }
      pass(`${transportLabel} reachable at ${baseUrl}`)
    } else {
      fail(`${transportLabel} endpoint responded with HTTP ${res.status} at ${primaryUrl}`)
      allOk = false
    }
  } catch (err) {
    fail(`${transportLabel} not reachable at ${baseUrl} — ${err?.message ?? err}`)
    allOk = false

    // llama.cpp fallback: /health (not all builds expose /v1/models)
    if (fallbackUrl) {
      try {
        const fallbackRes = await fetch(fallbackUrl)
        if (fallbackRes.ok) {
          reachable = true
          warn('/v1/models not available on this build — /health responded OK (model list check skipped)')
        }
      } catch { /* suppress: primary failure already reported */ }
    }
  }

  // Check 3: Model available
  if (!model) {
    warn('No model name configured — skipping model availability check')
    hint(`Set ${isOllama ? 'OLLAMA_MODEL' : 'LLAMA_CPP_MODEL'} or pass --model <name> to check a specific model`)
  } else if (!reachable) {
    warn('Model check skipped (server not reachable)')
  } else if (modelList === null) {
    warn(`Model list not available for this server build — cannot verify '${model}'`)
  } else {
    const found = modelList.some((m) => m === model || m.startsWith(`${model}:`))
    if (found) {
      pass(`Model '${model}' is available`)
    } else {
      fail(`Model '${model}' not found`)
      if (isOllama) {
        hint(`→ Run: ollama pull ${model}`)
      } else {
        hint(`→ Load the model with: llama-server --model /path/to/${model}.gguf --port 8080`)
      }
      if (modelList.length > 0) {
        const preview = modelList.slice(0, 5).join(', ')
        const tail = modelList.length > 5 ? ` (+ ${modelList.length - 5} more)` : ''
        hint(`Available: ${preview}${tail}`)
      } else {
        hint('No models loaded yet')
      }
      allOk = false
    }
  }

  // Check 4: Direct chat smoke test (opt-in via --ping)
  if (cliOptions_ping !== null && cliOptions_ping) {
    // handled by caller
  }

  return { allOk, reachable, modelList, transportLabel, isOllama, isLlamaCpp }
}

// ---------------------------------------------------------------------------
// Runtime smoke test helpers (used only with --smoke)
// ---------------------------------------------------------------------------

function buildSmokeWorkflow(modelName) {
  const escapedModel = modelName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    'on external "test"',
    '  result = model(',
    `    "${escapedModel}",`,
    '    "ping",',
    '    "if user says ping, answer with pong",',
    '    returns={ text:["pong"] },',
    '    retry_on_contract_violation=1,',
    '    on_contract_violation=emit("wrong_output")',
    '  )',
    '',
    '  if result',
    '    output text "pong"',
    '  end',
    'end',
    '',
    'on "wrong_output"',
    '  output text "...should have been pong"',
    'end',
  ].join('\n')
}

async function waitForHealth(port, timeoutMs) {
  const startedAt = Date.now()
  const url = `http://127.0.0.1:${port}/health`
  while ((Date.now() - startedAt) < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Runtime did not become healthy at ${url} within ${timeoutMs}ms`)
}

function connectWs(url, WebSocket) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(url)
    ws.once('open', () => res(ws))
    ws.once('error', (err) => rej(err))
  })
}

function sendCommand(ws, type, payload = {}, timeoutMs = 10000) {
  const requestId = randomUUID()
  return new Promise((resolveCmd, rejectCmd) => {
    const timeout = setTimeout(() => {
      cleanup()
      rejectCmd(new Error(`Timed out waiting for ${type} response`))
    }, timeoutMs)

    function onMessage(raw) {
      let message
      try { message = JSON.parse(String(raw ?? '{}')) } catch { return }
      if (message?.type !== 'response') return
      if (String(message.requestId ?? '') !== requestId) return
      cleanup()
      resolveCmd(message)
    }
    function onError(err) { cleanup(); rejectCmd(err) }
    function cleanup() {
      clearTimeout(timeout)
      ws.off('message', onMessage)
      ws.off('error', onError)
    }
    ws.on('message', onMessage)
    ws.on('error', onError)
    ws.send(JSON.stringify({ type, requestId, payload }))
  })
}

function extractTextOutputs(eventName, eventPayload) {
  const texts = []
  if (eventName === 'nextv_runtime_event') {
    const runtimeEvent = eventPayload?.runtimeEvent
    if (String(runtimeEvent?.type ?? '').trim() === 'output' &&
        String(runtimeEvent?.format ?? '').trim() === 'text') {
      texts.push(String(runtimeEvent?.content ?? ''))
    }
  }
  const events = eventPayload?.events
  if (Array.isArray(events)) {
    for (const entry of events) {
      if (String(entry?.type ?? '').trim() !== 'output') continue
      if (String(entry?.format ?? '').trim() !== 'text') continue
      texts.push(String(entry?.content ?? ''))
    }
  }
  return texts
}

function waitForOutcome(ws, timeoutMs) {
  return new Promise((resolveOutcome, rejectOutcome) => {
    const eventCounts = new Map()
    const timeout = setTimeout(() => {
      cleanup()
      const counts = Array.from(eventCounts.entries()).map(([n, c]) => `${n}:${c}`).join(', ')
      rejectOutcome(new Error(`Timed out waiting for text output within ${timeoutMs}ms (seen events: ${counts || 'none'})`))
    }, timeoutMs)

    function onMessage(raw) {
      let message
      try { message = JSON.parse(String(raw ?? '{}')) } catch { return }
      if (message?.type !== 'event') return

      const eventName = String(message.eventName ?? '')
      eventCounts.set(eventName, (eventCounts.get(eventName) ?? 0) + 1)

      if (eventName === 'nextv_error') {
        cleanup()
        rejectOutcome(new Error(`Runtime error event: ${JSON.stringify(message.payload ?? {})}`))
        return
      }
      if (eventName !== 'nextv_execution' && eventName !== 'nextv_runtime_event') return

      const texts = extractTextOutputs(eventName, message.payload)
      const first = texts.find((t) => t && t.trim().length > 0) ?? ''
      if (!first) return

      cleanup()
      resolveOutcome(first)
    }
    function onError(err) { cleanup(); rejectOutcome(err) }
    function cleanup() {
      clearTimeout(timeout)
      ws.off('message', onMessage)
      ws.off('error', onError)
    }
    ws.on('message', onMessage)
    ws.on('error', onError)
  })
}

async function runSmokeTest({ model, port, timeoutMs, repoRoot }) {
  const { default: WebSocket } = await import('ws')

  const tempWorkspace = join(repoRoot, '.tmp', `nerveflow-model-check-${randomUUID()}`)
  mkdirSync(tempWorkspace, { recursive: true })
  const workspaceRelPath = relative(repoRoot, tempWorkspace).replace(/\\/g, '/')

  writeFileSync(
    join(tempWorkspace, 'nerve.json'),
    JSON.stringify({ entrypointPath: 'sanity.nrv', externals: ['test'] }, null, 2),
    'utf8'
  )
  writeFileSync(join(tempWorkspace, 'sanity.nrv'), buildSmokeWorkflow(model), 'utf8')

  const runtime = spawn(process.execPath, [
    join(repoRoot, 'bin', 'nerve-runtime.js'),
    'start',
    workspaceRelPath,
    '--entrypoint', 'sanity.nrv',
    '--port', String(port),
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let runtimeStderr = ''
  runtime.stdout.on('data', () => {})
  runtime.stderr.on('data', (chunk) => { runtimeStderr += String(chunk ?? '') })

  let ws = null
  let smokeOk = false

  try {
    await waitForHealth(port, Math.min(timeoutMs, 20000))
    ws = await connectWs(`ws://127.0.0.1:${port}/api/runtime/ws`, WebSocket)

    const subscribeResponse = await sendCommand(ws, 'subscribe', {}, 10000)
    if (!subscribeResponse?.ok) {
      throw new Error(`Subscribe failed: ${JSON.stringify(subscribeResponse?.error ?? subscribeResponse)}`)
    }

    const outcomePromise = waitForOutcome(ws, timeoutMs)
    const enqueueResponse = await sendCommand(ws, 'enqueue_event', { eventType: 'test', value: '' }, 10000)
    if (!enqueueResponse?.ok) {
      throw new Error(`enqueue_event failed: ${JSON.stringify(enqueueResponse?.error ?? enqueueResponse)}`)
    }

    const outputText = await outcomePromise

    if (outputText === 'pong') {
      pass('Runtime smoke test passed — model() DSL round-trip works (received "pong")')
      smokeOk = true
    } else if (outputText === '...should have been pong') {
      warn('Runtime smoke test: contract fallback fired — model replied off-script but system works')
      smokeOk = true
    } else {
      fail(`Runtime smoke test: unexpected output "${outputText}"`)
    }
  } catch (err) {
    fail(`Runtime smoke test failed: ${err?.message ?? err}`)
    if (runtimeStderr.trim()) {
      console.error('--- runtime stderr ---')
      console.error(runtimeStderr.trim())
    }
  } finally {
    try { if (ws) ws.close() } catch {}
    try { runtime.kill('SIGTERM') } catch {}
    try { rmSync(tempWorkspace, { recursive: true, force: true }) } catch {}
  }

  return smokeOk
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Expose ping flag to inner helper without threading it through everywhere.
let cliOptions_ping = false

async function main() {
  let cliOptions
  try {
    cliOptions = parseCliOptions(process.argv.slice(2))
  } catch (err) {
    console.error(`nerve-model-check: ${err?.message ?? err}`)
    console.error(
      'Usage: nerve-model-check [<model>] [--transport ollama|llama.cpp] ' +
      '[--base-url <url>] [--model <name>] [--ping] [--smoke] [--preflight-timeout-ms <n>]'
    )
    process.exit(1)
  }

  cliOptions_ping = cliOptions.ping

  const transport = cliOptions.transport
    ?? String(process.env.AGENT_TRANSPORT ?? 'ollama').trim().toLowerCase()

  const isOllama   = transport === 'ollama'
  const isLlamaCpp = transport === 'llama.cpp' || transport === 'llama_cpp'

  if (!isOllama && !isLlamaCpp) {
    console.error(`nerve-model-check: unknown transport '${transport}'. Valid values: ollama, llama.cpp`)
    process.exit(1)
  }

  const envBaseUrl = isOllama
    ? String(process.env.OLLAMA_BASE_URL ?? '').trim()
    : String(process.env.LLAMA_CPP_BASE_URL ?? '').trim()
  const defaultBaseUrl = isOllama ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_LLAMA_CPP_BASE_URL
  const baseUrl = String(cliOptions.baseUrl ?? (envBaseUrl || defaultBaseUrl)).replace(/\/+$/, '')

  const modelEnv = isOllama
    ? String(process.env.OLLAMA_MODEL ?? '').trim()
    : String(process.env.LLAMA_CPP_MODEL ?? '').trim()
  const model = String(cliOptions.model ?? modelEnv).trim()
  const preflightTimeoutRaw = Number(cliOptions.preflightTimeoutMs ?? process.env.MODEL_CHECK_PREFLIGHT_TIMEOUT_MS)
  const preflightTimeoutMs = Number.isFinite(preflightTimeoutRaw) && preflightTimeoutRaw > 0
    ? Math.floor(preflightTimeoutRaw)
    : 15000

  const transportLabel = isOllama ? 'Ollama' : 'llama.cpp'

  console.log(`\nnerve-model-check — transport: ${transportLabel}   base-url: ${baseUrl}\n`)

  let allOk = true
  let reachable = false
  let modelList = null

  // -------------------------------------------------------------------------
  // Check 1: Node.js version >= 18
  // -------------------------------------------------------------------------
  const nodeMajor = Number(String(process.versions.node).split('.')[0])
  if (nodeMajor >= 18) {
    pass(`Node.js ${process.versions.node} (>= 18 required)`)
  } else {
    fail(`Node.js ${process.versions.node} is below the required minimum of 18`)
    allOk = false
  }

  // -------------------------------------------------------------------------
  // Check 2: Endpoint reachable
  // -------------------------------------------------------------------------
  const primaryUrl  = isOllama ? `${baseUrl}/api/tags` : `${baseUrl}/v1/models`
  const fallbackUrl = isLlamaCpp ? `${baseUrl}/health` : null

  try {
    const res = await fetchWithTimeout(primaryUrl, {}, preflightTimeoutMs)
    if (res.ok) {
      reachable = true
      const body = await res.json().catch(() => null)
      if (isOllama && Array.isArray(body?.models)) {
        modelList = body.models.map((m) => String(m?.name ?? m?.model ?? m))
      } else if (isLlamaCpp && Array.isArray(body?.data)) {
        modelList = body.data.map((m) => String(m?.id ?? m))
      }
      pass(`${transportLabel} reachable at ${baseUrl}`)
    } else {
      fail(`${transportLabel} endpoint responded with HTTP ${res.status} at ${primaryUrl}`)
      allOk = false
    }
  } catch (err) {
    fail(`${transportLabel} not reachable at ${baseUrl} — ${err?.message ?? err}`)
    allOk = false

    if (fallbackUrl) {
      try {
        const fallbackRes = await fetchWithTimeout(fallbackUrl, {}, preflightTimeoutMs)
        if (fallbackRes.ok) {
          reachable = true
          warn('/v1/models not available on this build — /health responded OK (model list check skipped)')
        }
      } catch { /* suppress */ }
    }
  }

  // -------------------------------------------------------------------------
  // Check 3: Model available
  // -------------------------------------------------------------------------
  if (!model) {
    warn('No model name configured — skipping model availability check')
    hint(`Set ${isOllama ? 'OLLAMA_MODEL' : 'LLAMA_CPP_MODEL'} or pass --model <name> to check a specific model`)
  } else if (!reachable) {
    warn('Model check skipped (server not reachable)')
  } else if (modelList === null) {
    warn(`Model list not available for this server build — cannot verify '${model}'`)
  } else {
    const found = modelList.some((m) => m === model || m.startsWith(`${model}:`))
    if (found) {
      pass(`Model '${model}' is available`)
    } else {
      fail(`Model '${model}' not found`)
      if (isOllama) {
        hint(`→ Run: ollama pull ${model}`)
      } else {
        hint(`→ Load the model with: llama-server --model /path/to/${model}.gguf --port 8080`)
      }
      if (modelList.length > 0) {
        const preview = modelList.slice(0, 5).join(', ')
        const tail = modelList.length > 5 ? ` (+ ${modelList.length - 5} more)` : ''
        hint(`Available: ${preview}${tail}`)
      } else {
        hint('No models loaded yet')
      }
      allOk = false
    }
  }

  // -------------------------------------------------------------------------
  // Check 4: Direct chat ping (opt-in via --ping)
  // -------------------------------------------------------------------------
  if (cliOptions.ping) {
    if (!model) {
      warn('--ping skipped: no model configured (pass --model <name>)')
    } else if (!reachable) {
      warn('--ping skipped: server not reachable')
    } else {
      const chatUrl = isOllama ? `${baseUrl}/api/chat` : `${baseUrl}/v1/chat/completions`
      const chatBody = isOllama
        ? { model, messages: [{ role: 'user', content: 'ping' }], stream: false }
        : { model, messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 4 }
      try {
        const chatRes = await fetchWithTimeout(chatUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chatBody),
        }, preflightTimeoutMs)
        if (!chatRes.ok) {
          const bodyText = await chatRes.text().catch(() => '')
          fail(`Chat ping failed: HTTP ${chatRes.status} — ${bodyText.slice(0, 120) || chatRes.statusText}`)
          allOk = false
        } else {
          const chatPayload = await chatRes.json()
          const text = isOllama
            ? String(chatPayload?.message?.content ?? chatPayload?.response ?? '').trim()
            : String(chatPayload?.choices?.[0]?.message?.content ?? '').trim()
          if (text.length > 0) {
            const preview = text.length > 60 ? `${text.slice(0, 60)}…` : text
            pass(`Chat ping OK — "${preview}"`)
          } else {
            fail('Chat ping returned empty response')
            allOk = false
          }
        }
      } catch (err) {
        fail(`Chat ping failed: ${err?.message ?? err}`)
        allOk = false
      }
    }
  }

  // -------------------------------------------------------------------------
  // Summary (preflight)
  // -------------------------------------------------------------------------
  console.log('')
  if (!allOk) {
    console.log('nerve-model-check: preflight failed\n')
    if (!reachable) {
      if (isOllama) {
        console.log('  Install Ollama:')
        console.log('    macOS / Linux : curl -fsSL https://ollama.com/install.sh | sh')
        console.log('    Windows       : https://ollama.com/download/windows')
        console.log('')
        console.log('  Start server  : ollama serve')
        console.log('  Pull a model  : ollama pull llama3.2')
      } else {
        console.log('  Install llama.cpp:')
        console.log('    Releases : https://github.com/ggml-org/llama.cpp/releases')
        console.log('    macOS    : brew install llama.cpp')
        console.log('')
        console.log('  Start server  : llama-server --model /path/to/model.gguf --port 8080')
        console.log('  Get a model   : https://huggingface.co/models?library=gguf')
      }
      console.log('')
    }
    process.exit(1)
  }

  if (!cliOptions.smoke) {
    console.log(`nerve-model-check: all checks passed — ${transportLabel} is ready\n`)
    process.exit(0)
  }

  // -------------------------------------------------------------------------
  // Check 5: Runtime smoke test (--smoke)
  // -------------------------------------------------------------------------
  if (!model) {
    console.error('nerve-model-check: --smoke requires a model name (pass --model <name> or a bare positional arg)')
    process.exit(1)
  }

  section('Running runtime smoke test…')

  const repoRoot = resolve(process.cwd())
  const smokeOk = await runSmokeTest({
    model,
    port: cliOptions.smokePort,
    timeoutMs: cliOptions.smokeTimeoutMs,
    repoRoot,
  })

  console.log('')
  if (smokeOk) {
    console.log(`nerve-model-check: all checks passed — ${transportLabel} and runtime are ready\n`)
    process.exit(0)
  } else {
    console.log('nerve-model-check: runtime smoke test failed\n')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`nerve-model-check: unexpected error: ${err?.message ?? err}`)
  process.exit(1)
})
