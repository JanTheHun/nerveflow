import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const SERVER_BOOT_TIMEOUT_MS = 20000

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

function waitForOutput(child, text, timeoutMs = SERVER_BOOT_TIMEOUT_MS) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false
    let output = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectReady(new Error(`Timed out waiting for output '${text}'. Output:\n${output}`))
    }, timeoutMs)

    const onData = (chunk) => {
      output += String(chunk)
      if (output.includes(text)) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveReady(output)
      }
    }

    const onExit = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectReady(new Error(`Process exited before expected output (code=${code}, signal=${signal}). Output:\n${output}`))
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })
}

function stopProcess(child) {
  return new Promise((resolveExit) => {
    if (!child || child.killed) return resolveExit()

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
      resolveExit()
    }, 5000)

    child.once('exit', () => {
      clearTimeout(timer)
      resolveExit()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolveExit()
    }
  })
}

async function waitForSnapshot(url, predicate, timeoutMs = 15000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      const payload = await response.json().catch(() => ({}))
      if (predicate(response, payload)) {
        return { response, payload }
      }
    } catch {
      // retry while service is booting/connecting
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error('Timed out waiting for snapshot condition')
}

test('preview server proxies control commands over remote ws runtime', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
      '--remote-ws',
      `ws://127.0.0.1:${runtimePort}/api/runtime/ws`,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const snapshotUrl = `http://127.0.0.1:${studioPort}/api/nextv/snapshot`

    const initial = await waitForSnapshot(
      snapshotUrl,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws' && payload?.running === true,
    )

    assert.equal(initial.payload.remoteMode, true)
    assert.equal(initial.payload.remoteControl, true)
    assert.equal(initial.payload.remoteTransport, 'ws')

    const enqueueResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'sensor_reading', value: '55', source: 'external' }),
    })
    const enqueuePayload = await enqueueResponse.json().catch(() => ({}))

    assert.equal(enqueueResponse.ok, true)
    assert.equal(enqueuePayload.ok, true)
    assert.equal(typeof enqueuePayload.snapshot, 'object')

    const ingressResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/ingress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'missing_ingress', value: 'x' }),
    })
    const ingressPayload = await ingressResponse.json().catch(() => ({}))

    assert.equal(ingressResponse.status, 503)
    assert.equal(ingressPayload.ok, false)
    assert.equal(ingressPayload.remoteControl, true)

    const stopResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const stopPayload = await stopResponse.json().catch(() => ({}))

    assert.equal(stopResponse.ok, true)
    assert.equal(stopPayload.ok, true)
    assert.equal(stopPayload?.snapshot?.running, false)

    const finalSnapshot = await waitForSnapshot(
      snapshotUrl,
      (response, payload) => response.ok && payload?.running === false,
    )
    assert.equal(finalSnapshot.payload.remoteControl, true)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
  }
})

test('preview server supports attach runtime target with per-request ws url', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const attachWsUrl = `ws://127.0.0.1:${runtimePort}/api/runtime/ws`
    const encodedAttachWsUrl = encodeURIComponent(attachWsUrl)
    const snapshotUrl = `http://127.0.0.1:${studioPort}/api/nextv/snapshot?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`

    const initial = await waitForSnapshot(
      snapshotUrl,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws' && payload?.running === true,
    )

    assert.equal(initial.payload.remoteMode, true)
    assert.equal(initial.payload.remoteControl, true)
    assert.equal(initial.payload.remoteTransport, 'ws')
    assert.equal(initial.payload.capabilities?.workspaceFileTree, false)
    assert.equal(initial.payload.capabilities?.workspaceFileRead, false)
    assert.equal(initial.payload.capabilities?.workspaceFileWrite, false)

    const treeResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/workspace/tree?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}&workspaceDir=${encodeURIComponent('examples/mqtt-simple-host')}`,
    )
    const treePayload = await treeResponse.json().catch(() => ({}))

    assert.equal(treeResponse.status, 405)
    assert.equal(treePayload.ok, false)
    assert.equal(treePayload.capabilities?.workspaceFileTree, false)
    assert.equal(treePayload.capabilities?.workspaceFileRead, false)
    assert.equal(treePayload.capabilities?.workspaceFileWrite, false)

    const enqueueResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/event?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'sensor_reading', value: '59', source: 'external' }),
    })
    const enqueuePayload = await enqueueResponse.json().catch(() => ({}))

    assert.equal(enqueueResponse.ok, true)
    assert.equal(enqueuePayload.ok, true)

    const stopResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/stop?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const stopPayload = await stopResponse.json().catch(() => ({}))

    assert.equal(stopResponse.ok, true)
    assert.equal(stopPayload.ok, true)
    assert.equal(stopPayload?.snapshot?.running, false)

    const missingAttachUrlResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/start?runtimeTarget=attach`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceDir: 'examples/mqtt-simple-host' }),
    })
    const missingAttachUrlPayload = await missingAttachUrlResponse.json().catch(() => ({}))

    assert.equal(missingAttachUrlResponse.status, 400)
    assert.equal(missingAttachUrlPayload.ok, false)
    assert.match(String(missingAttachUrlPayload.error ?? ''), /attach mode requires attachWsUrl/i)

    const attachRunResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/run?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceDir: 'examples/mqtt-simple-host' }),
    })
    const attachRunPayload = await attachRunResponse.json().catch(() => ({}))

    assert.equal(attachRunResponse.status, 400)
    assert.equal(attachRunPayload.error, 'run endpoint is only for external runtime mode')
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
  }
})

test('preview server call inspector rejects mixed prompt and promptParts', async () => {
  const studioPort = await findOpenPort()
  let studioChild

  try {
    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const response = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/call-inspector/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'model',
        mode: 'try',
        model: 'test-model',
        prompt: 'legacy',
        promptParts: ['structured'],
      }),
    })
    const payload = await response.json().catch(() => ({}))

    assert.equal(response.status, 400)
    assert.match(String(payload.error ?? ''), /prompt and promptParts cannot both be set/i)
  } finally {
    await stopProcess(studioChild)
  }
})

test('preview server attach call inspector forwards structured prompt and instruction parts', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    'examples/mqtt-simple-host',
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const attachWsUrl = `ws://127.0.0.1:${runtimePort}/api/runtime/ws`
    const encodedAttachWsUrl = encodeURIComponent(attachWsUrl)

    await waitForSnapshot(
      `http://127.0.0.1:${studioPort}/api/nextv/snapshot?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws' && payload?.running === true,
    )

    const response = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/call-inspector/execute?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetKind: 'model',
          mode: 'try',
          model: 'test-model',
          promptParts: ['alpha', 'beta'],
          instructionParts: ['be concise'],
        }),
      },
    )

    const payload = await response.json().catch(() => ({}))

    assert.equal(response.ok, true)
    assert.equal(payload.ok, true)
    assert.equal(payload.call?.targetKind, 'model')
    assert.match(String(payload.resolvedCall?.prompt ?? ''), /alpha/)
    assert.match(String(payload.resolvedCall?.prompt ?? ''), /beta/)
    assert.match(String(payload.resolvedCall?.instructions ?? ''), /be concise/)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
  }
})

test('preview server graph endpoint returns controlEdges contract', async () => {
  const studioPort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(process.cwd(), '.tmp-studio-graph-'))
  const workspaceRelativePath = relative(process.cwd(), workspaceAbsolutePath).replace(/\\/g, '/')

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'entry.nrv',
    externals: ['bounded', 'unbounded', 'mixed', 'unknown'],
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'entry.nrv'), [
    'on "bounded"',
    '  decision = agent("router", event.value, returns={ intent: "" })',
    '  if decision.intent == "chat"',
    '    emit("chat", event.value)',
    '  end',
    'end',
    '',
    'on "unbounded"',
    '  raw = agent("router", event.value)',
    '  if raw.intent == "chat"',
    '    emit("chat", event.value)',
    '  end',
    'end',
    '',
    'on "mixed"',
    '  boundedDecision = agent("router", event.value, returns={ intent: "" })',
    '  unboundedDecision = agent("router", event.value)',
    '  if boundedDecision.intent == unboundedDecision.intent',
    '    emit("chat", event.value)',
    '  end',
    'end',
    '',
    'on "unknown"',
    '  if state.mode == "debug"',
    '    emit("chat", event.value)',
    '  end',
    'end',
  ].join('\n'), 'utf8')

  let studioChild

  try {
    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const response = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/graph?workspaceDir=${encodeURIComponent(workspaceRelativePath)}`,
    )
    const payload = await response.json().catch(() => ({}))

    assert.equal(response.ok, true)
    assert.equal(payload.ok, true)
    assert.equal(payload.workspaceDir, workspaceRelativePath)
    assert.equal(payload.entrypointPath, 'entry.nrv')
    assert.ok(Array.isArray(payload.controlEdges))
    assert.equal(payload.controlEdges.length, 8)

    const allowedProvenance = new Set(['bounded', 'unbounded', 'mixed', 'unknown'])
    for (const edge of payload.controlEdges) {
      assert.equal(typeof edge.eventType, 'string')
      assert.equal(typeof edge.from, 'string')
      assert.equal(typeof edge.to, 'string')
      assert.equal(edge.type, 'control')
      assert.ok(edge.branch === 'if_true' || edge.branch === 'if_false')
      assert.ok(allowedProvenance.has(edge.provenance))
      assert.equal(edge.boundedControl, edge.provenance === 'bounded')
      if (edge.sourcePath) {
        assert.equal(edge.sourcePath, 'entry.nrv')
      }
    }
  } finally {
    await stopProcess(studioChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})

test('preview server attach mode uses runtime workspace metadata without env-dependent config loading', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(process.cwd(), '.tmp-studio-attach-config-'))
  const workspaceRelativePath = relative(process.cwd(), workspaceAbsolutePath).replace(/\\/g, '/')

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'workflow.nrv',
    externals: ['ping'],
    transports: {
      openai: {
        provider: 'openai_compat',
        baseUrl: '${env:OPENAI_BASE_URL}',
        apiKey: 'stub-key',
      },
    },
    models: {
      router: {
        model: 'gpt-4o-mini',
        transport: 'openai',
      },
    },
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'workflow.nrv'), [
    'on "ping"',
    '  emit("pong", event.value)',
    'end',
  ].join('\n'), 'utf8')

  const runtimeEnv = {
    ...process.env,
    OPENAI_BASE_URL: 'http://127.0.0.1:9999',
  }
  const studioEnv = { ...process.env }
  delete studioEnv.OPENAI_BASE_URL

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    workspaceRelativePath,
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: runtimeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...studioEnv,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const attachWsUrl = `ws://127.0.0.1:${runtimePort}/api/runtime/ws`
    const encodedAttachWsUrl = encodeURIComponent(attachWsUrl)

    const workspaceConfigResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/workspace-config?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`,
    )
    const workspaceConfigPayload = await workspaceConfigResponse.json().catch(() => ({}))

    assert.equal(workspaceConfigResponse.ok, true)
    assert.equal(workspaceConfigPayload.ok, true)
    assert.equal(workspaceConfigPayload.source, 'runtime')
    assert.equal(workspaceConfigPayload.runtimeOwned, true)
    assert.equal(workspaceConfigPayload.workspaceDir, workspaceRelativePath)
    assert.equal(workspaceConfigPayload.entrypointPath, 'workflow.nrv')
    assert.deepEqual(workspaceConfigPayload.declaredExternals, ['ping'])

    const definitionStatusResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/definition-status?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`,
    )
    const definitionStatusPayload = await definitionStatusResponse.json().catch(() => ({}))

    assert.equal(definitionStatusResponse.ok, true)
    assert.equal(definitionStatusPayload.ok, true)
    assert.equal(definitionStatusPayload.active?.workspaceDir, workspaceRelativePath)
    assert.equal(definitionStatusPayload.active?.entrypointPath, 'workflow.nrv')
    assert.equal(typeof definitionStatusPayload.active?.activeDefinitionId, 'string')
    assert.equal(typeof definitionStatusPayload.active?.definitionHash, 'string')

    const graphResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/graph?runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`,
    )
    const graphPayload = await graphResponse.json().catch(() => ({}))

    assert.equal(graphResponse.ok, true)
    assert.equal(graphPayload.ok, true)
    assert.equal(graphPayload.workspaceDir, workspaceRelativePath)
    assert.equal(graphPayload.entrypointPath, 'workflow.nrv')
    assert.ok(Array.isArray(graphPayload.nodes))
    assert.ok(Array.isArray(graphPayload.edges))
    assert.ok(graphPayload.nodes.length > 0)
    assert.ok(graphPayload.edges.length > 0)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})

test('preview server remote-control mode uses runtime graph without local env expansion', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(process.cwd(), '.tmp-studio-remote-ws-graph-'))
  const workspaceRelativePath = relative(process.cwd(), workspaceAbsolutePath).replace(/\\/g, '/')

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'workflow.nrv',
    externals: ['ping'],
    transports: {
      openai: {
        provider: 'openai_compat',
        baseUrl: '${env:OPENAI_BASE_URL}',
        apiKey: 'stub-key',
      },
    },
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'workflow.nrv'), [
    'on "ping"',
    '  emit("pong", event.value)',
    'end',
  ].join('\n'), 'utf8')

  const runtimeEnv = { ...process.env, OPENAI_BASE_URL: 'http://127.0.0.1:9999' }
  const studioEnv = { ...process.env }
  delete studioEnv.OPENAI_BASE_URL

  const runtimeChild = spawn(process.execPath, [
    'bin/nerve-runtime.js',
    'start',
    workspaceRelativePath,
    '--port',
    String(runtimePort),
  ], {
    cwd: process.cwd(),
    env: runtimeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
      '--remote-ws',
      `ws://127.0.0.1:${runtimePort}/api/runtime/ws`,
    ], {
      cwd: process.cwd(),
      env: { ...studioEnv, PORT: String(studioPort) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    // Wait for remote bridge to be connected
    await waitForSnapshot(
      `http://127.0.0.1:${studioPort}/api/nextv/snapshot`,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws',
    )

    const graphResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/graph`)
    const graphPayload = await graphResponse.json().catch(() => ({}))

    assert.equal(graphResponse.ok, true, `graph request failed: ${JSON.stringify(graphPayload)}`)
    assert.equal(graphPayload.ok, true)
    assert.equal(graphPayload.workspaceDir, workspaceRelativePath)
    assert.equal(graphPayload.entrypointPath, 'workflow.nrv')
    assert.ok(Array.isArray(graphPayload.nodes))
    assert.ok(Array.isArray(graphPayload.edges))
    assert.ok(graphPayload.nodes.length > 0)
    assert.ok(graphPayload.edges.length > 0)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})

test('preview server attach mode works with composable-reference-host as observability surface', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()

  const runtimeChild = spawn(process.execPath, [
    'examples/composable-reference-host/server.js',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKSPACE_DIR: 'examples/mqtt-simple-host',
      PORT: String(runtimePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'Host running')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const attachWsUrl = `ws://127.0.0.1:${runtimePort}/api/runtime/ws`
    const encodedAttachWsUrl = encodeURIComponent(attachWsUrl)
    const attachQuery = `runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`

    const initial = await waitForSnapshot(
      `http://127.0.0.1:${studioPort}/api/nextv/snapshot?${attachQuery}`,
      (response, payload) => response.ok && payload?.remoteTransport === 'ws' && payload?.running === true,
    )

    assert.equal(initial.payload.remoteMode, true)
    assert.equal(initial.payload.remoteControl, true)
    assert.equal(initial.payload.remoteTransport, 'ws')
    assert.equal(initial.payload.capabilities?.workspaceFileTree, false)
    assert.equal(initial.payload.capabilities?.workspaceFileRead, false)
    assert.equal(initial.payload.capabilities?.workspaceFileWrite, false)

    const workspaceConfigResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/workspace-config?${attachQuery}`,
    )
    const workspaceConfigPayload = await workspaceConfigResponse.json().catch(() => ({}))

    assert.equal(workspaceConfigResponse.ok, true)
    assert.equal(workspaceConfigPayload.ok, true)
    assert.equal(workspaceConfigPayload.source, 'runtime')
    assert.equal(workspaceConfigPayload.runtimeOwned, true)
    assert.equal(workspaceConfigPayload.workspaceDir, '.')

    const definitionStatusResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/definition-status?${attachQuery}`,
    )
    const definitionStatusPayload = await definitionStatusResponse.json().catch(() => ({}))

    assert.equal(definitionStatusResponse.ok, true)
    assert.equal(definitionStatusPayload.ok, true)
    assert.equal(definitionStatusPayload.active?.workspaceDir, '.')
    assert.equal(typeof definitionStatusPayload.active?.activeDefinitionId, 'string')
    assert.equal(typeof definitionStatusPayload.active?.definitionHash, 'string')

    const graphResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/graph?${attachQuery}`)
    const graphPayload = await graphResponse.json().catch(() => ({}))

    assert.equal(graphResponse.ok, true)
    assert.equal(graphPayload.ok, true)
    assert.equal(graphPayload.workspaceDir, '.')
    assert.ok(Array.isArray(graphPayload.nodes))
    assert.ok(Array.isArray(graphPayload.edges))
    assert.ok(graphPayload.nodes.length > 0)

    const fileResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/file/content?${attachQuery}&kind=editor&filePath=${encodeURIComponent('examples/mqtt-simple-host/nextv.json')}`,
    )
    const filePayload = await fileResponse.json().catch(() => ({}))

    assert.equal(fileResponse.status, 405)
    assert.equal(filePayload.ok, false)
    assert.equal(filePayload.capabilities?.workspaceFileTree, false)
    assert.equal(filePayload.capabilities?.workspaceFileRead, false)
    assert.equal(filePayload.capabilities?.workspaceFileWrite, false)
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
  }
})

test('composable-reference-host accepts external absolute workspace folder', async () => {
  const runtimePort = await findOpenPort()
  const studioPort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(tmpdir(), 'nerveflow-composable-ext-'))

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'workflow.nrv',
    externals: ['ping'],
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'workflow.nrv'), [
    'on "ping"',
    '  emit("pong", event.value)',
    'end',
  ].join('\n'), 'utf8')

  const runtimeChild = spawn(process.execPath, [
    'examples/composable-reference-host/server.js',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKSPACE_DIR: workspaceAbsolutePath,
      PORT: String(runtimePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let studioChild

  try {
    await waitForOutput(runtimeChild, 'Host running')

    studioChild = spawn(process.execPath, [
      'nerve-studio/preview-server.js',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(studioPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(studioChild, 'nerve-studio preview running at')

    const attachWsUrl = `ws://127.0.0.1:${runtimePort}/api/runtime/ws`
    const encodedAttachWsUrl = encodeURIComponent(attachWsUrl)
    const attachQuery = `runtimeTarget=attach&attachWsUrl=${encodedAttachWsUrl}`

    const snapshot = await waitForSnapshot(
      `http://127.0.0.1:${studioPort}/api/nextv/snapshot?${attachQuery}`,
      (response, payload) => response.ok && payload?.running === true && payload?.remoteTransport === 'ws',
    )

    assert.equal(snapshot.payload.remoteMode, true)
    assert.equal(snapshot.payload.remoteControl, true)
    assert.equal(snapshot.payload.capabilities?.workspaceFileRead, false)

    const workspaceConfigResponse = await fetch(
      `http://127.0.0.1:${studioPort}/api/nextv/workspace-config?${attachQuery}`,
    )
    const workspaceConfigPayload = await workspaceConfigResponse.json().catch(() => ({}))

    assert.equal(workspaceConfigResponse.ok, true)
    assert.equal(workspaceConfigPayload.ok, true)
    assert.equal(workspaceConfigPayload.runtimeOwned, true)
    assert.equal(workspaceConfigPayload.entrypointPath, 'workflow.nrv')

    const graphResponse = await fetch(`http://127.0.0.1:${studioPort}/api/nextv/graph?${attachQuery}`)
    const graphPayload = await graphResponse.json().catch(() => ({}))

    assert.equal(graphResponse.ok, true)
    assert.equal(graphPayload.ok, true)
    assert.equal(graphPayload.entrypointPath, 'workflow.nrv')
    assert.ok(Array.isArray(graphPayload.nodes))
    assert.ok(Array.isArray(graphPayload.edges))
  } finally {
    await stopProcess(studioChild)
    await stopProcess(runtimeChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})

test('composable-reference-host auto-loads workspace .env for env-backed config', async () => {
  const runtimePort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(tmpdir(), 'nerveflow-composable-env-'))

  writeFileSync(join(workspaceAbsolutePath, '.env'), [
    'OPENAI_BASE_URL=http://127.0.0.1:9999',
  ].join('\n'), 'utf8')

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'workflow.nrv',
    externals: ['ping'],
    transports: {
      openai: {
        provider: 'openai_compat',
        baseUrl: '${env:OPENAI_BASE_URL}',
        apiKey: 'stub-key',
      },
    },
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'workflow.nrv'), [
    'on "ping"',
    '  emit("pong", event.value)',
    'end',
  ].join('\n'), 'utf8')

  const runtimeEnv = { ...process.env }
  delete runtimeEnv.OPENAI_BASE_URL

  const runtimeChild = spawn(process.execPath, [
    'examples/composable-reference-host/server.js',
  ], {
    cwd: process.cwd(),
    env: {
      ...runtimeEnv,
      WORKSPACE_DIR: workspaceAbsolutePath,
      PORT: String(runtimePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForOutput(runtimeChild, 'Loaded 1 env var')
    await waitForOutput(runtimeChild, 'Host running')
  } finally {
    await stopProcess(runtimeChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})

test('composable-reference-host uses cwd as workspace when omitted', async () => {
  const runtimePort = await findOpenPort()
  const workspaceAbsolutePath = mkdtempSync(join(tmpdir(), 'nerveflow-composable-cwd-'))

  writeFileSync(join(workspaceAbsolutePath, 'nextv.json'), JSON.stringify({
    entrypointPath: 'workflow.nrv',
    externals: ['ping'],
  }, null, 2))

  writeFileSync(join(workspaceAbsolutePath, 'workflow.nrv'), [
    'on "ping"',
    '  emit("pong", event.value)',
    'end',
  ].join('\n'), 'utf8')

  const hostScriptPath = resolve(process.cwd(), 'examples/composable-reference-host/server.js')
  const runtimeChild = spawn(process.execPath, [
    hostScriptPath,
  ], {
    cwd: workspaceAbsolutePath,
    env: {
      ...process.env,
      PORT: String(runtimePort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    await waitForOutput(runtimeChild, `Workspace: ${workspaceAbsolutePath}`)
    await waitForOutput(runtimeChild, 'Host running')
  } finally {
    await stopProcess(runtimeChild)
    rmSync(workspaceAbsolutePath, { recursive: true, force: true })
  }
})
