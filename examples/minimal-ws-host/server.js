import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../../src/runtime/index.js'

import {
  createToolRuntime,
} from '../../src/host_core/index.js'

import {
  createOpenAICompatTransport,
} from '../../src/host_core/agent_transports/index.js'

const workspaceDirArg = String(process.argv[2] ?? '').trim()
const workspaceInput = workspaceDirArg || '.'
const WORKSPACE_ABSOLUTE_PATH = resolve(process.cwd(), workspaceInput)

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
  const envPath = resolve(workspaceAbsolutePath, '.env')
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

const envLoad = loadWorkspaceEnv(WORKSPACE_ABSOLUTE_PATH)

const PORT = Number(process.env.PORT ?? 4190)
const WS_PATH = '/api/runtime/ws'
const callAgent = createOpenAICompatTransport()

const resolvers = createRuntimeResolvers({ repoRoot: WORKSPACE_ABSOLUTE_PATH })

const toolRuntime = createToolRuntime({
  providers: [
    {
      async get_time() {
        return new Date().toISOString()
      },
    },
  ],
})

const runtimeCore = createRuntimeCore({
  resolvers,
  toolRuntime,
  callAgent,
})

const server = createServer()

const wsSurface = createRuntimeWebSocketSurface({
  server,
  runtimeCore,
  path: WS_PATH,
})

try {
  await runtimeCore.start({
    workspaceDir: '.',
  })
} catch (error) {
  console.error(`minimal-ws-host failed to start runtime: ${error?.message ?? error}`)
  process.exit(1)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`minimal-ws-host listening at http://127.0.0.1:${PORT}`)
  console.log(`minimal-ws-host websocket surface: ws://127.0.0.1:${PORT}${WS_PATH}`)
  if (envLoad.loaded) {
    console.log(`minimal-ws-host loaded ${envLoad.applied} env var${envLoad.applied === 1 ? '' : 's'} from ${envLoad.filePath}`)
  }
})

let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`minimal-ws-host received ${signal}, shutting down...`)

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
