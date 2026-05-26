#!/usr/bin/env node

/**
 * Composable Reference Host
 *
 * This example shows host setup only: embed the runtime, attach capabilities,
 * attach surfaces, and run against a caller-provided workflow workspace.
 *
 * Usage:
 *   WORKSPACE_DIR=../memory-agent PORT=4190 node server.js
 *   node server.js ../memory-agent
 *
 * Then connect via WebSocket:
 *   ws://127.0.0.1:4190/api/runtime/ws
 */

import path from 'node:path'
import { existsSync, readFileSync, statSync } from 'node:fs'

import {
  createComposableHost,
} from '../../src/host_core/index.js'

import {
  createOpenAICompatTransport,
} from '../../src/host_core/agent_transports/index.js'

import {
  wsSurface,
} from '../../src/runtime/index.js'

function parseCliOptions(argv) {
  const options = {
    workspaceArg: '',
    hotSwap: false,
  }

  for (const rawToken of argv) {
    const token = String(rawToken ?? '').trim()
    if (!token) continue
    if (token === '--hot-swap') {
      options.hotSwap = true
      continue
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown argument: ${token}`)
    }
    if (options.workspaceArg) {
      throw new Error(`Unexpected extra argument: ${token}`)
    }
    options.workspaceArg = token
  }

  return options
}

function resolveWorkspaceDir(options) {
  const workspaceInput = process.env.WORKSPACE_DIR || options.workspaceArg || '.'

  const absolutePath = path.resolve(process.cwd(), workspaceInput)
  const stats = statSync(absolutePath)
  if (!stats.isDirectory()) {
    throw new Error(`workspace path must be a directory: ${absolutePath}`)
  }

  return {
    absolutePath,
  }
}

function stripEnvValueQuotes(valueRaw) {
  const value = String(valueRaw ?? '')
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

function loadWorkspaceEnv(workspaceAbsolutePath) {
  const envPath = path.join(workspaceAbsolutePath, '.env')
  if (!existsSync(envPath)) {
    return {
      loaded: false,
      filePath: envPath,
      applied: 0,
    }
  }

  const source = readFileSync(envPath, 'utf8')
  let applied = 0

  for (const rawLine of source.split(/\r?\n/)) {
    const line = String(rawLine ?? '')
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue

    let key = trimmed.slice(0, equalsIndex).trim()
    if (!key) continue
    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim()
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue

    const valueRaw = trimmed.slice(equalsIndex + 1).trim()
    process.env[key] = stripEnvValueQuotes(valueRaw)
    applied += 1
  }

  return {
    loaded: true,
    filePath: envPath,
    applied,
  }
}

const port = parseInt(process.env.PORT || '4190', 10)
const callAgent = createOpenAICompatTransport()

async function main() {
  const cliOptions = parseCliOptions(process.argv.slice(2))
  const workspace = resolveWorkspaceDir(cliOptions)
  const envLoad = loadWorkspaceEnv(workspace.absolutePath)

  console.log('🌐 Composable Reference Host')
  console.log(`📁 Workspace: ${workspace.absolutePath}`)
  console.log(`🔌 Port: ${port}`)
  console.log(`♻️ Hot-swap: ${cliOptions.hotSwap ? 'enabled' : 'disabled'}`)
  if (envLoad.loaded) {
    console.log(`🔐 Loaded ${envLoad.applied} env var${envLoad.applied === 1 ? '' : 's'} from ${envLoad.filePath}`)
  }
  console.log('')

  // Create the composable host
  const host = createComposableHost({
    // Resolve runtime paths relative to the target workspace itself so
    // this host can run from any external project folder.
    repoRoot: workspace.absolutePath,
    workspaceDir: '.',
    autoAttachCapabilitiesFromWorkspace: true,
    port,
    callAgent,
    defaultModel: 'mistral',
    slowAgentWarningMs: 2000,
    parallelMaxConcurrency: 4,
    hotSwap: cliOptions.hotSwap,
  })

  console.log('📦 Attaching capabilities from workspace config...')

  console.log('📡 Attaching surfaces...')
  host.attachSurface(
    wsSurface({
      path: '/api/runtime/ws',
    })
  )
  console.log('  ✓ WebSocket surface')

  console.log('')
  console.log('🚀 Starting host...')

  const result = await host.start()

  console.log('✅ Host running')
  console.log(`📍 WebSocket: ws://127.0.0.1:${result.port}${result.wsPath}`)
  console.log('')
  console.log('Ready for connections. Press Ctrl+C to stop.')

  process.on('SIGINT', async () => {
    console.log('')
    console.log('🛑 Shutting down...')
    await host.shutdown()
    console.log('✅ Shutdown complete')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  console.error('Usage: WORKSPACE_DIR=path/to/workspace node examples/composable-reference-host/server.js [workspaceDir] [--hot-swap]')
  console.error('Tip: use nerve-compose add to declare capabilities in your workspace config')
  process.exit(1)
})
