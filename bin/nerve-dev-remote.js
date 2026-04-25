#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

function parseArgs(argv) {
  const options = {
    workspaceDir: '',
    entrypointPath: '',
    runtimePort: 4190,
    studioPort: 4173,
    wsPath: '/api/runtime/ws',
    openBrowser: true,
  }

  let index = 0
  while (index < argv.length) {
    const token = String(argv[index] ?? '').trim()
    if (!token) {
      index += 1
      continue
    }

    if (token === '--entrypoint') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--entrypoint requires a value')
      options.entrypointPath = value
      index += 2
      continue
    }

    if (token === '--runtime-port') {
      const value = Number(argv[index + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--runtime-port requires a positive integer')
      options.runtimePort = value
      index += 2
      continue
    }

    if (token === '--studio-port') {
      const value = Number(argv[index + 1])
      if (!Number.isInteger(value) || value <= 0) throw new Error('--studio-port requires a positive integer')
      options.studioPort = value
      index += 2
      continue
    }

    if (token === '--ws-path') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) throw new Error('--ws-path requires a value')
      options.wsPath = value.startsWith('/') ? value : `/${value}`
      index += 2
      continue
    }

    if (token === '--no-open') {
      options.openBrowser = false
      index += 1
      continue
    }

    if (token === '--open') {
      options.openBrowser = true
      index += 1
      continue
    }

    if (token.startsWith('--')) {
      throw new Error(`Unknown argument: ${token}`)
    }

    if (!options.workspaceDir) {
      options.workspaceDir = token
      index += 1
      continue
    }

    throw new Error(`Unexpected positional argument: ${token}`)
  }

  if (!options.workspaceDir) {
    throw new Error('Usage: nerve-dev-remote <workspaceDir> [--entrypoint <path>] [--runtime-port <n>] [--studio-port <n>] [--ws-path <path>] [--no-open]')
  }

  return options
}

function pipeWithPrefix(stream, output, prefix, onLine) {
  if (!stream) return

  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += String(chunk)
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      output.write(`[${prefix}] ${line}\n`)
      if (typeof onLine === 'function') {
        try {
          onLine(line)
        } catch {}
      }
    }
  })

  stream.on('end', () => {
    if (buffer) {
      output.write(`[${prefix}] ${buffer}\n`)
      if (typeof onLine === 'function') {
        try {
          onLine(buffer)
        } catch {}
      }
      buffer = ''
    }
  })
}

function openUrlInBrowser(url) {
  if (!url) return
  try {
    if (process.platform === 'win32') {
      const proc = spawn('cmd', ['/c', 'start', '', url], {
        stdio: 'ignore',
        detached: true,
      })
      proc.unref()
      return
    }

    if (process.platform === 'darwin') {
      const proc = spawn('open', [url], { stdio: 'ignore', detached: true })
      proc.unref()
      return
    }

    const proc = spawn('xdg-open', [url], { stdio: 'ignore', detached: true })
    proc.unref()
  } catch (err) {
    console.error(`[dev] could not open browser automatically: ${String(err?.message ?? err)}`)
  }
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (err) {
  console.error(`nerve-dev-remote argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const runtimeScript = resolve(repoRoot, 'bin', 'nerve-runtime.js')
const studioScript = resolve(repoRoot, 'nerve-studio', 'preview-server.js')
const runtimeWsUrl = `ws://127.0.0.1:${options.runtimePort}${options.wsPath}`

const runtimeArgs = [
  runtimeScript,
  'start',
  options.workspaceDir,
  '--port',
  String(options.runtimePort),
  '--ws-path',
  options.wsPath,
]
if (options.entrypointPath) {
  runtimeArgs.push('--entrypoint', options.entrypointPath)
}

const studioArgs = [
  studioScript,
  '--remote',
  '--remote-ws',
  runtimeWsUrl,
]

console.log('[dev] starting runtime + remote studio')
console.log(`[dev] runtime workspace: ${options.workspaceDir}`)
if (options.entrypointPath) {
  console.log(`[dev] runtime entrypoint: ${options.entrypointPath}`)
}
console.log(`[dev] runtime ws: ${runtimeWsUrl}`)
console.log(`[dev] studio url: http://127.0.0.1:${options.studioPort}`)
if (!options.openBrowser) {
  console.log('[dev] browser auto-open disabled (--no-open)')
}

const runtimeProc = spawn(process.execPath, runtimeArgs, {
  cwd: repoRoot,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const studioProc = spawn(process.execPath, studioArgs, {
  cwd: repoRoot,
  env: { ...process.env, PORT: String(options.studioPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
})

pipeWithPrefix(runtimeProc.stdout, process.stdout, 'runtime')
pipeWithPrefix(runtimeProc.stderr, process.stderr, 'runtime')
let browserOpened = false
const studioUrl = `http://127.0.0.1:${options.studioPort}`
pipeWithPrefix(studioProc.stdout, process.stdout, 'studio', (line) => {
  if (!options.openBrowser || browserOpened) return
  if (!line.includes('nerve-studio preview running at')) return
  browserOpened = true
  openUrlInBrowser(studioUrl)
  console.log(`[dev] opened browser: ${studioUrl}`)
})
pipeWithPrefix(studioProc.stderr, process.stderr, 'studio')

let shuttingDown = false

function shutdown(signal = 'exit') {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[dev] shutting down (${signal})`)

  for (const proc of [studioProc, runtimeProc]) {
    if (!proc || proc.killed) continue
    try {
      proc.kill('SIGTERM')
    } catch {}
  }

  setTimeout(() => {
    for (const proc of [studioProc, runtimeProc]) {
      if (!proc || proc.killed) continue
      try {
        proc.kill('SIGKILL')
      } catch {}
    }
  }, 1200).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

let runtimeExitCode = null
let studioExitCode = null

runtimeProc.on('exit', (code, signal) => {
  runtimeExitCode = code
  if (!shuttingDown) {
    console.error(`[dev] runtime exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`)
    shutdown('runtime_exit')
  }
  maybeExit()
})

studioProc.on('exit', (code, signal) => {
  studioExitCode = code
  if (!shuttingDown) {
    console.error(`[dev] studio exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`)
    shutdown('studio_exit')
  }
  maybeExit()
})

function maybeExit() {
  if (runtimeExitCode == null || studioExitCode == null) return
  const exitCode = runtimeExitCode === 0 && studioExitCode === 0 ? 0 : 1
  process.exit(exitCode)
}
