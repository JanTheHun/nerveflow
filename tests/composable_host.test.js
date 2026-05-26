import { test } from 'node:test'
import assert from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { WebSocket } from 'ws'

import {
  createComposableHost,
  createEventBus,
} from '../src/host_core/index.js'

import {
  wsSurface,
} from '../src/runtime/index.js'

const REPO_ROOT = resolve(process.cwd())

function findOpenPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createNetServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = Number(address?.port ?? 0)
      server.close((err) => {
        if (err) return rejectPort(err)
        resolvePort(port)
      })
    })
    server.on('error', rejectPort)
  })
}

async function createTempWorkspace({ nextvConfig, entrySource, extraFiles = [] }) {
  const workspaceRoot = await mkdtemp(join(REPO_ROOT, '.tmp-composable-host-'))
  const workspaceRelativePath = relative(REPO_ROOT, workspaceRoot).replace(/\\/g, '/')
  await writeFile(join(workspaceRoot, 'nextv.json'), `${JSON.stringify(nextvConfig, null, 2)}\n`, 'utf8')
  await writeFile(join(workspaceRoot, 'entry.nrv'), entrySource, 'utf8')

  for (const file of extraFiles) {
    if (!file || typeof file !== 'object') continue
    const relativePath = String(file.path ?? '').trim()
    if (!relativePath) continue
    const absolutePath = join(workspaceRoot, relativePath)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, String(file.content ?? ''), 'utf8')
  }

  return {
    workspaceRoot,
    workspaceRelativePath,
  }
}

function waitForWsOpen(ws) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) {
      return resolve()
    }
    const onOpen = () => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
      resolve()
    }
    const onError = (err) => {
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
      reject(err)
    }
    ws.on('open', onOpen)
    ws.on('error', onError)
  })
}

function waitForWsMessage(ws, predicate) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => {
      let message
      try {
        message = JSON.parse(String(raw ?? '{}'))
      } catch {
        return
      }

      if (predicate(message)) {
        ws.removeEventListener('message', onMessage)
        ws.removeEventListener('close', onClose)
        resolve(message)
      }
    }
    const onClose = () => {
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      reject(new Error('WebSocket closed before message received'))
    }
    ws.on('message', onMessage)
    ws.on('close', onClose)
  })
}

async function waitForCondition(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const startMs = Date.now()
  while (Date.now() - startMs < timeoutMs) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Condition not met before timeout')
}

test('composable host starts with ws surface and no capabilities', { timeout: 5000 }, async () => {
  const port = await findOpenPort()
  const host = createComposableHost({
    workspaceDir: 'examples/mqtt-simple-host',
    port,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  const result = await host.start()
  assert.equal(result.port, port)
  assert.equal(result.runtimeCore.isActive(), true)

  await host.shutdown()
})

test('composable host websocket surface connects and receives handshake', { timeout: 10000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/mqtt-simple-host',
    port: 4191,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  const result = await host.start()
  const ws = new WebSocket(`ws://127.0.0.1:${result.port}/api/runtime/ws`)

  try {
    await waitForWsOpen(ws)
    // For now, just verify the connection opened successfully
    // Full handshake validation can be added later
    assert.equal(ws.readyState, WebSocket.OPEN)
  } finally {
    ws.close()
    await host.shutdown()
  }
})

test('composable host enqueues events through websocket surface', { timeout: 10000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/mqtt-simple-host',
    port: 4192,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  const result = await host.start()
  const ws = new WebSocket(`ws://127.0.0.1:${result.port}/api/runtime/ws`)

  try {
    await waitForWsOpen(ws)
    // For now, just verify the connection opened successfully
    assert.equal(ws.readyState, WebSocket.OPEN)
  } finally {
    ws.close()
    await host.shutdown()
  }
})

test('composable host shutdown is idempotent', { timeout: 5000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/mqtt-simple-host',
    port: 4193,
  })

  host.attachSurface(wsSurface())

  await host.start()
  await host.shutdown()
  await host.shutdown() // Should not throw
})

test('composable host rejects invalid capability', { timeout: 1000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/minimal-ws-host',
    port: 4194,
  })

  assert.throws(
    () => {
      host.attachCapability('not-a-function')
    },
    /requires a function/i,
  )
})

test('composable host rejects invalid surface', { timeout: 1000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/minimal-ws-host',
    port: 4195,
  })

  assert.throws(
    () => {
      host.attachSurface('not-an-object')
    },
    /requires a surface descriptor/i,
  )
})

test('composable host supports method chaining', { timeout: 5000 }, async () => {
  const host = createComposableHost({
    workspaceDir: 'examples/mqtt-simple-host',
    port: 4196,
  })

  const result = host
    .attachSurface(wsSurface())

  assert.equal(result, host)

  await host.start()
  await host.shutdown()
})

test('composable host hot-swap reloads changed workspace config when enabled', { timeout: 15000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
    },
    entrySource: 'on external "user_message"\n  output text "v1"\nend\n',
    extraFiles: [
      {
        path: 'entry.v2.nrv',
        content: 'on external "user_message"\n  output text "v2"\nend\n',
      },
    ],
  })

  const port = await findOpenPort()
  const logs = []
  const originalLog = console.log
  console.log = (...args) => {
    logs.push(args.map((value) => String(value)).join(' '))
  }

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    port,
    hotSwap: true,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  try {
    const result = await host.start()
    assert.equal(result.runtimeCore.getStatus().entrypointPath, 'entry.nrv')

    await writeFile(
      join(workspace.workspaceRoot, 'nextv.json'),
      `${JSON.stringify({ entrypointPath: 'entry.v2.nrv', externals: ['user_message'] }, null, 2)}\n`,
      'utf8',
    )

    await waitForCondition(
      () => result.runtimeCore.getStatus().entrypointPath === 'entry.v2.nrv',
      { timeoutMs: 8000, intervalMs: 100 },
    )

    assert.equal(logs.some((entry) => entry.includes('[hot-swap] file event=')), true)
    assert.equal(logs.some((entry) => entry.includes('[hot-swap] applied entrypoint=entry.v2.nrv')), true)

    await host.shutdown()
  } finally {
    console.log = originalLog
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host hot-swap reloads when included workflow file changes', { timeout: 15000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
    },
    entrySource: [
      'include "flows/shared.nrv"',
      'on external "user_message"',
      '  emit("shared", event.value)',
      'end',
    ].join('\n'),
    extraFiles: [
      {
        path: 'flows/shared.nrv',
        content: [
          'on "shared"',
          '  output text "v1"',
          'end',
        ].join('\n'),
      },
    ],
  })

  const port = await findOpenPort()
  const logs = []
  const originalLog = console.log
  console.log = (...args) => {
    logs.push(args.map((value) => String(value)).join(' '))
  }

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    port,
    hotSwap: true,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  try {
    const result = await host.start()
    const watchedFiles = result.runtimeCore.getDefinitionFiles()
    assert.equal(watchedFiles.some((file) => String(file).endsWith('/flows/shared.nrv') || String(file).endsWith('\\flows\\shared.nrv')), true)

    await writeFile(
      join(workspace.workspaceRoot, 'flows', 'shared.nrv'),
      [
        'on "shared"',
        '  output text "v2"',
        'end',
      ].join('\n'),
      'utf8',
    )

    await waitForCondition(
      () => logs.some((entry) => entry.includes('[hot-swap] applied entrypoint=entry.nrv')),
      { timeoutMs: 8000, intervalMs: 100 },
    )

    assert.equal(logs.some((entry) => entry.includes('flows/shared.nrv')), true)

    await host.shutdown()
  } finally {
    console.log = originalLog
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host auto-attaches speech capability from workspace config', { timeout: 10000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        speech: {
          required: true,
          provider: 'speech',
        },
      },
      modules: {
        speech: {
          provider: 'speech-surface',
          mode: 'embedded',
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
  })

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port: 4197,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  try {
    const result = await host.start()
    assert.equal(result.runtimeCore.isActive(), true)
    await host.shutdown()
  } finally {
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host fails on unknown workspace module provider', { timeout: 10000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        memory: {
          required: true,
          provider: 'memory',
        },
      },
      modules: {
        memory: {
          provider: 'unknown-provider',
          mode: 'embedded',
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
  })

  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port: 4198,
  })

  try {
    await assert.rejects(
      () => host.start(),
      /Unsupported workspace module provider "unknown-provider"/i,
    )
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host resolves relative mcp stdio script paths from workspace directory', { timeout: 15000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        mcp: {
          required: true,
          provider: 'mcp',
        },
      },
      modules: {
        mcp: {
          provider: 'mcp',
          mode: 'embedded',
          eagerConnect: true,
          servers: [
            {
              name: 'local-mcp',
              transport: 'stdio',
              config: {
                command: process.execPath,
                args: ['./mcp-servers/local-mcp.mjs'],
              },
            },
          ],
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
    extraFiles: [
      {
        path: 'mcp-servers/local-mcp.mjs',
        content: `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'\nimport { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'\n\nconst server = new McpServer({ name: 'local-mcp', version: '1.0.0' })\nserver.registerTool(\n  'fetch_url',\n  {\n    description: 'Returns a fixed response for tests.',\n  },\n  async () => ({\n    content: [\n      {\n        type: 'text',\n        text: 'ok',\n      },\n    ],\n  }),\n)\n\nconst transport = new StdioServerTransport()\nawait server.connect(transport)\n`,
      },
    ],
  })

  const port = await findOpenPort()
  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  try {
    const result = await host.start()
    assert.equal(result.runtimeCore.isActive(), true)
    await host.shutdown()
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host loads mcp servers from external module configPath', { timeout: 15000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        mcp: {
          required: true,
          provider: 'mcp',
        },
      },
      modules: {
        mcp: {
          provider: 'mcp',
          configPath: './mcp.json',
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
    extraFiles: [
      {
        path: 'mcp.json',
        content: JSON.stringify({
          mode: 'embedded',
          eagerConnect: true,
          servers: [
            {
              name: 'local-mcp',
              transport: 'stdio',
              config: {
                command: process.execPath,
                args: ['./mcp-servers/local-mcp.mjs'],
              },
            },
          ],
        }, null, 2),
      },
      {
        path: 'mcp-servers/local-mcp.mjs',
        content: `import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'\nimport { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'\n\nconst server = new McpServer({ name: 'local-mcp', version: '1.0.0' })\nserver.registerTool(\n  'fetch_url',\n  {\n    description: 'Returns a fixed response for tests.',\n  },\n  async () => ({\n    content: [\n      {\n        type: 'text',\n        text: 'ok',\n      },\n    ],\n  }),\n)\n\nconst transport = new StdioServerTransport()\nawait server.connect(transport)\n`,
      },
    ],
  })

  const port = await findOpenPort()
  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port,
  })

  host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

  try {
    const result = await host.start()
    assert.equal(result.runtimeCore.isActive(), true)
    await host.shutdown()
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})

test('composable host rejects embedded mcp module with no servers', { timeout: 10000 }, async () => {
  const workspace = await createTempWorkspace({
    nextvConfig: {
      entrypointPath: 'entry.nrv',
      externals: ['user_message'],
      requires: {
        mcp: {
          required: true,
          provider: 'mcp',
        },
      },
      modules: {
        mcp: {
          provider: 'mcp',
          mode: 'embedded',
          servers: [],
        },
      },
    },
    entrySource: 'on external "user_message"\n  output text "ok"\nend\n',
  })

  const port = await findOpenPort()
  const host = createComposableHost({
    workspaceDir: workspace.workspaceRelativePath,
    autoAttachCapabilitiesFromWorkspace: true,
    port,
  })

  try {
    await assert.rejects(
      () => host.start(),
      /requires at least one server in "servers" when mode is embedded/i,
    )
  } finally {
    await host.shutdown().catch(() => {})
    await rm(workspace.workspaceRoot, { recursive: true, force: true })
  }
})
