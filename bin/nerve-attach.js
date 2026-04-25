#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

function parseCliOptions(argv) {
  const [url, command, ...rest] = argv
  const wsUrl = String(url ?? '').trim()
  const cmd = String(command ?? '').trim().toLowerCase()

  if (!wsUrl || !cmd) {
    throw new Error('Usage: nerve-attach <wsUrl> <snapshot|stop|enqueue|start|listen> [args]')
  }

  const options = {
    wsUrl,
    command: cmd,
    commandPayload: {},
  }

  if (cmd === 'enqueue') {
    const eventType = String(rest[0] ?? '').trim()
    const value = rest.slice(1).join(' ')
    if (!eventType) throw new Error('enqueue requires <eventType> [value]')
    options.commandType = 'enqueue_event'
    options.commandPayload = { eventType, value }
  } else if (cmd === 'start') {
    const workspaceDir = String(rest[0] ?? '').trim()
    const entrypointPath = String(rest[1] ?? '').trim()
    if (!workspaceDir) throw new Error('start requires <workspaceDir> [entrypointPath]')
    options.commandType = 'start'
    options.commandPayload = { workspaceDir }
    if (entrypointPath) options.commandPayload.entrypointPath = entrypointPath
  } else if (cmd === 'snapshot') {
    options.commandType = 'snapshot'
  } else if (cmd === 'stop') {
    options.commandType = 'stop'
  } else if (cmd === 'listen') {
    options.commandType = 'subscribe'
  } else {
    throw new Error(`Unknown command: ${cmd}`)
  }

  return options
}

function connectWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.once('open', () => resolve(ws))
    ws.once('error', (err) => reject(err))
  })
}

async function main() {
  let options
  try {
    options = parseCliOptions(process.argv.slice(2))
  } catch (err) {
    console.error(`nerve-attach argument error: ${err?.message ?? err}`)
    process.exit(1)
  }

  let ws
  try {
    ws = await connectWebSocket(options.wsUrl)
  } catch (err) {
    console.error(`nerve-attach connection error: ${err?.message ?? err}`)
    process.exit(1)
  }

  const pending = new Map()

  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw ?? '{}'))
    } catch {
      return
    }

    if (message?.type === 'event') {
      const eventName = String(message.eventName ?? '')
      const payload = message.payload
      console.log(JSON.stringify({ eventName, payload }, null, 2))
      return
    }

    if (message?.type !== 'response') return

    const requestId = String(message.requestId ?? '')
    if (!requestId) {
      // initial handshake response; ignore for one-shot command handling
      return
    }

    const resolver = pending.get(requestId)
    if (!resolver) return
    pending.delete(requestId)
    resolver(message)
  })

  if (options.command === 'listen') {
    const requestId = randomUUID()
    ws.send(JSON.stringify({
      type: 'subscribe',
      requestId,
      payload: {},
    }))

    console.log('nerve-attach subscribed. streaming events...')
    ws.on('close', () => {
      process.exit(0)
    })
    return
  }

  const requestId = randomUUID()
  const responsePromise = new Promise((resolve) => {
    pending.set(requestId, resolve)
  })

  ws.send(JSON.stringify({
    type: options.commandType,
    requestId,
    payload: options.commandPayload,
  }))

  const timeout = setTimeout(() => {
    if (pending.has(requestId)) {
      pending.delete(requestId)
      console.error('nerve-attach timed out waiting for response')
      try { ws.close() } catch {}
      process.exit(1)
    }
  }, 10000)

  const response = await responsePromise
  clearTimeout(timeout)

  console.log(JSON.stringify(response, null, 2))
  ws.close()
}

main().catch((err) => {
  console.error(`nerve-attach fatal error: ${err?.message ?? err}`)
  process.exit(1)
})
