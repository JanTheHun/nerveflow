import { createServer } from 'node:http'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createRuntimeCore,
  createRuntimeResolvers,
  createRuntimeWebSocketSurface,
} from '../../src/runtime/index.js'

import {
  createToolRuntime,
} from '../../src/host_core/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(join(__dirname, '..', '..'))

const workspaceDirArg = String(process.argv[2] ?? '').trim()
if (!workspaceDirArg) {
  console.error('Usage: node server.js <workspaceDir>')
  console.error('Example: node examples/minimal-ws-host/server.js path/to/my-project')
  process.exit(1)
}
const WORKSPACE_DIR = relative(REPO_ROOT, resolve(process.cwd(), workspaceDirArg)).replace(/\\/g, '/') || '.'

const PORT = Number(process.env.PORT ?? 4190)
const WS_PATH = '/api/runtime/ws'

const resolvers = createRuntimeResolvers({ repoRoot: REPO_ROOT })

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
})

const server = createServer()

const wsSurface = createRuntimeWebSocketSurface({
  server,
  runtimeCore,
  path: WS_PATH,
})

try {
  await runtimeCore.start({
    workspaceDir: WORKSPACE_DIR,
  })
} catch (error) {
  console.error(`minimal-ws-host failed to start runtime: ${error?.message ?? error}`)
  process.exit(1)
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`minimal-ws-host listening at http://127.0.0.1:${PORT}`)
  console.log(`minimal-ws-host websocket surface: ws://127.0.0.1:${PORT}${WS_PATH}`)
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
