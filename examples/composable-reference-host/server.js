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

import {
  createComposableHost,
} from '../../src/host_core/index.js'

import {
  wsSurface,
} from '../../src/runtime/index.js'

function resolveWorkspaceDir() {
  const workspaceArg = process.argv[2]
  const workspaceInput = process.env.WORKSPACE_DIR || workspaceArg

  if (!workspaceInput) {
    throw new Error('workspace directory required; pass WORKSPACE_DIR or the first CLI argument')
  }

  const absolutePath = path.resolve(process.cwd(), workspaceInput)
  const runtimeWorkspaceDir = path.relative(process.cwd(), absolutePath).replace(/\\/g, '/') || '.'

  if (runtimeWorkspaceDir.startsWith('..') || path.isAbsolute(runtimeWorkspaceDir)) {
    throw new Error('workspace directory must be inside the current repository')
  }

  return {
    absolutePath,
    runtimeWorkspaceDir,
  }
}

const port = parseInt(process.env.PORT || '4190', 10)

async function main() {
  const workspace = resolveWorkspaceDir()

  console.log('🌐 Composable Reference Host')
  console.log(`📁 Workspace: ${workspace.absolutePath}`)
  console.log(`🔌 Port: ${port}`)
  console.log('')

  // Create the composable host
  const host = createComposableHost({
    workspaceDir: workspace.runtimeWorkspaceDir,
    autoAttachCapabilitiesFromWorkspace: true,
    port,
    callAgent: callMockAgent,
    defaultModel: 'mistral',
    slowAgentWarningMs: 2000,
    parallelMaxConcurrency: 4,
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

async function callMockAgent(input) {
  console.log(`[Agent] Processing: ${input.eventType || input.content || JSON.stringify(input).slice(0, 50)}`)

  await new Promise((resolve) => setTimeout(resolve, 100))

  return {
    type: 'agent_result',
    data: {
      processedBy: 'reference-host-mock-agent',
      timestamp: new Date().toISOString(),
    },
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  console.error('Usage: WORKSPACE_DIR=path/to/workspace node examples/composable-reference-host/server.js')
  console.error('Tip: use nerve-compose add to declare capabilities in your workspace config')
  process.exit(1)
})
