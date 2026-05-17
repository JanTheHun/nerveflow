/**
 * mqtt-simple-host entry point.
 *
 * Wires the MQTT client to the host core and subscribes to the command topic.
 * Headless: no HTTP server or UI. Designed for outer-world manipulation from
 * a running nerve project.
 *
 * Configuration via environment variables:
 *   MQTT_BROKER_URL            - default: mqtt://localhost:1883
 *   MQTT_COMMAND_TOPIC         - default: nextv/command
 *   MQTT_EVENT_TOPIC_PREFIX    - default: nextv/event
 *   MQTT_RESPONSE_TOPIC_PREFIX - default: nextv/response
 *   MQTT_INCLUDE_EVENTS        - comma-separated canonical event names to publish;
 *                                empty = publish all
 *   AGENT_TRANSPORT            - 'ollama' (default) or 'llama.cpp'
 *   OLLAMA_BASE_URL            - default: http://127.0.0.1:11434 (used when AGENT_TRANSPORT=ollama)
 *   OLLAMA_MODEL               - default: '' (agent profile model is used first)
 *   LLAMA_CPP_BASE_URL         - default: http://127.0.0.1:8080 (used when AGENT_TRANSPORT=llama.cpp)
 *   MQTT_AUTOSTART_WORKSPACE   - workspace-relative path to auto-start on connect (e.g. nerve-studio/workspaces-local/chatbot)
 *   MQTT_AUTOSTART_ENTRYPOINT  - entrypoint path relative to workspace; optional if nerve.json/nextv.json declares it
 *
 * Command-line flags:
 *   --workspace <path>         - workspace-relative project directory
 *   --entrypoint <path>        - entrypoint path relative to workspace
 *   --autostart                - start the provided workspace after MQTT connect
 */
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { connect as mqttConnect } from 'mqtt'

import {
  loadWorkspaceNextVConfig,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
} from '../../src/host_core/index.js'

import { createMqttHost } from './create-mqtt-host.js'
import { createOllamaTransport, createLlamaCppTransport } from '../../src/host_core/agent_transports/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(join(__dirname, '..', '..'))

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883'
const MQTT_COMMAND_TOPIC = process.env.MQTT_COMMAND_TOPIC ?? 'nextv/command'
const MQTT_EVENT_TOPIC_PREFIX = process.env.MQTT_EVENT_TOPIC_PREFIX ?? 'nextv/event'
const MQTT_RESPONSE_TOPIC_PREFIX = process.env.MQTT_RESPONSE_TOPIC_PREFIX ?? 'nextv/response'
const AGENT_TRANSPORT = String(process.env.AGENT_TRANSPORT ?? 'ollama').trim().toLowerCase()
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? ''
const LLAMA_CPP_BASE_URL = process.env.LLAMA_CPP_BASE_URL ?? 'http://127.0.0.1:8080'

const MQTT_AUTOSTART_WORKSPACE = (process.env.MQTT_AUTOSTART_WORKSPACE ?? '').trim()
const MQTT_AUTOSTART_ENTRYPOINT = (process.env.MQTT_AUTOSTART_ENTRYPOINT ?? '').trim()

const rawInclude = (process.env.MQTT_INCLUDE_EVENTS ?? '').trim()
const INCLUDE_EVENTS = rawInclude
  ? new Set(rawInclude.split(',').map((s) => s.trim()).filter(Boolean))
  : null

function parseCliOptions(argv) {
  const options = {
    workspace: '',
    entrypoint: '',
    autostart: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? '').trim()
    if (token === '--autostart') {
      options.autostart = true
      continue
    }
    if (token === '--workspace' || token === '--entrypoint') {
      const value = String(argv[index + 1] ?? '').trim()
      if (!value || value.startsWith('--')) {
        throw new Error(`${token} requires a value`)
      }
      if (token === '--workspace') options.workspace = value
      else options.entrypoint = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${token}`)
  }

  if (options.autostart && !options.workspace) {
    throw new Error('--autostart requires --workspace <path>')
  }

  return options
}

let cliOptions
try {
  cliOptions = parseCliOptions(process.argv.slice(2))
} catch (err) {
  console.error(`mqtt-simple-host argument error: ${err?.message ?? err}`)
  process.exit(1)
}

const AUTOSTART_WORKSPACE = cliOptions.autostart
  ? cliOptions.workspace
  : MQTT_AUTOSTART_WORKSPACE
const AUTOSTART_ENTRYPOINT = cliOptions.entrypoint || MQTT_AUTOSTART_ENTRYPOINT

// --- Path helpers (workspace-relative) ---

function toWorkspaceDisplayPath(absolutePath) {
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath
  return rel.replace(/\\/g, '/')
}

function readJsonObjectFile(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`JSON at ${toWorkspaceDisplayPath(filePath)} must be an object`)
  }
  return parsed
}

function resolveWorkspaceDirectory(inputPath) {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) {
    const rel = relative(REPO_ROOT, __dirname).replace(/\\/g, '/')
    return { absolutePath: __dirname, relativePath: rel || '.' }
  }
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')
  const absolutePath = resolve(REPO_ROOT, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
  if (!existsSync(absolutePath)) throw new Error(`Workspace directory not found: ${candidate.replace(/\\/g, '/')}`)
  return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
}

function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
  const candidate = String(inputPath ?? '').trim()
  if (!candidate) throw new Error('filePath required')
  if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')
  const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
  const rel = relative(REPO_ROOT, absolutePath)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path is outside workspace')
  const ext = extname(absolutePath).toLowerCase()
  if (kindRaw === 'script' && ext && ext !== '.nrv' && ext !== '.wfs') {
    throw new Error(`Unsupported extension '${ext}' for script`)
  }
  return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
}

function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
  const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
  const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
  if (!rawEntrypoint) throw new Error('entrypointPath required (or set nerve.json/nextv.json entrypointPath)')
  const joined = join(
    workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath,
    rawEntrypoint,
  )
  const entrypoint = resolvePathFromBaseDirectory(REPO_ROOT, joined.replace(/\\/g, '/'), 'script')
  if (!existsSync(entrypoint.absolutePath)) {
    throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
  }
  return entrypoint
}

const callAgent = (AGENT_TRANSPORT === 'llama.cpp' || AGENT_TRANSPORT === 'llama_cpp')
  ? createLlamaCppTransport({ baseUrl: LLAMA_CPP_BASE_URL })
  : createOllamaTransport({ baseUrl: OLLAMA_BASE_URL })

// --- MQTT client and host wiring ---

const mqttClient = mqttConnect(MQTT_BROKER_URL, {
  clientId: `nerveflow-${randomUUID()}`,
  clean: true,
})

const host = createMqttHost(
  mqttClient,
  {
    resolveWorkspaceDirectory,
    loadWorkspaceConfig: (workspaceDir) =>
      loadWorkspaceNextVConfig({
        workspaceDir,
        toWorkspaceDisplayPath,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      }),
    resolveEntrypoint,
    resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath,
    readJsonObjectFile,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    existsSync,
  },
  {
    commandTopic: MQTT_COMMAND_TOPIC,
    eventTopicPrefix: MQTT_EVENT_TOPIC_PREFIX,
    responseTopicPrefix: MQTT_RESPONSE_TOPIC_PREFIX,
    includeEvents: INCLUDE_EVENTS,
    callAgent,
    defaultModel: OLLAMA_MODEL,
  },
)

mqttClient.on('connect', () => {
  mqttClient.subscribe(MQTT_COMMAND_TOPIC, (err) => {
    if (err) {
      console.error(
        `mqtt-simple-host failed to subscribe to ${MQTT_COMMAND_TOPIC}:`,
        err.message,
      )
      process.exit(1)
    }
    console.log(`mqtt-simple-host connected to ${MQTT_BROKER_URL}`)
    console.log(`mqtt-simple-host listening on ${MQTT_COMMAND_TOPIC}`)
    console.log('[ATTACH] MQTT surface attached (control + observability)')

    if (AUTOSTART_WORKSPACE) {
      const startPayload = { workspaceDir: AUTOSTART_WORKSPACE }
      if (AUTOSTART_ENTRYPOINT) startPayload.entrypointPath = AUTOSTART_ENTRYPOINT
      const command = JSON.stringify({ type: 'start', requestId: randomUUID(), payload: startPayload })
      console.log(`mqtt-simple-host autostarting workspace: ${AUTOSTART_WORKSPACE}`)
      host.handleCommand(command).catch((err) => {
        console.error('mqtt-simple-host autostart failed:', err?.message ?? err)
      })
    }
  })
})

mqttClient.on('error', (err) => {
  console.error('mqtt-simple-host MQTT error:', err?.message ?? err)
})

mqttClient.on('close', () => {
  console.log('[DETACH] MQTT surface detached (connection closed)')
  console.log('mqtt-simple-host runtime continues (if active)')
})

function shutdown() {
  console.log('[DETACH] mqtt-simple-host shutting down...')
  host.shutdown()
  mqttClient.end()
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
