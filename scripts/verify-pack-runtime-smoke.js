#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const BOOT_TIMEOUT_MS = 20000

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun({ code, signal, stdout, stderr })
        return
      }
      rejectRun(new Error(
        `${command} ${args.join(' ')} failed (code=${code}, signal=${signal ?? 'none'})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ))
    })
  })
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return runCommand('cmd.exe', ['/c', 'npm', ...args], options)
  }
  return runCommand('npm', args, options)
}

function parseJsonObjects(text) {
  const source = String(text ?? '')
  const results = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index]

    if (inString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }

    if (ch === '}') {
      if (depth === 0) continue
      depth -= 1
      if (depth === 0 && start >= 0) {
        const candidate = source.slice(start, index + 1)
        try {
          results.push(JSON.parse(candidate))
        } catch {
          // Keep scanning until a valid object appears.
        }
        start = -1
      }
    }
  }

  return results
}

function parseAttachResponseOrThrow(text, context) {
  const objects = parseJsonObjects(text)
  const response = objects.find((obj) => obj?.type === 'response' && typeof obj?.ok === 'boolean')
    ?? objects.find((obj) => typeof obj?.ok === 'boolean')

  if (response) return response
  throw new Error(`${context} did not return a response envelope\nOutput:\n${text}`)
}

function waitForOutput(child, expectedText, timeoutMs = BOOT_TIMEOUT_MS) {
  return new Promise((resolveReady, rejectReady) => {
    let output = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      rejectReady(new Error(`Timed out waiting for output '${expectedText}'. Output:\n${output}`))
    }, timeoutMs)

    const onData = (chunk) => {
      output += String(chunk)
      if (!output.includes(expectedText) || settled) return
      settled = true
      clearTimeout(timer)
      resolveReady(output)
    }

    const onExit = (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectReady(new Error(`Process exited before expected output (code=${code}, signal=${signal ?? 'none'}). Output:\n${output}`))
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', onExit)
  })
}

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

function stopChild(child) {
  return new Promise((resolveStop) => {
    if (!child || child.killed) {
      resolveStop()
      return
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch {}
      resolveStop()
    }, 5000)

    child.once('exit', () => {
      clearTimeout(timer)
      resolveStop()
    })

    try {
      child.kill('SIGTERM')
    } catch {
      clearTimeout(timer)
      resolveStop()
    }
  })
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nerveflow-pack-smoke-'))
  const port = await findOpenPort()
  let tarballName = ''
  let runtimeChild = null

  try {
    console.log('[pack-smoke] creating npm pack artifact')
    const packResult = await runNpm(['pack', '--json'], { cwd: REPO_ROOT })
    const parsed = JSON.parse(String(packResult.stdout || '[]'))
    tarballName = String(parsed?.[0]?.filename ?? '').trim()
    if (!tarballName) {
      throw new Error(`npm pack did not return a filename\nstdout:\n${packResult.stdout}`)
    }

    const tarballPath = path.join(REPO_ROOT, tarballName)
    console.log(`[pack-smoke] installing ${tarballName} into temp workspace`)
    await runNpm(['install', '--no-package-lock', '--no-audit', '--fund=false', tarballPath], { cwd: tempRoot })

    const installedBinDir = path.join(tempRoot, 'node_modules', 'nerveflow', 'bin')
    const installedRoot = path.join(tempRoot, 'node_modules', 'nerveflow')
    const runtimeScript = path.join(installedBinDir, 'nerve-runtime.js')
    const attachScript = path.join(installedBinDir, 'nerve-attach.js')
    const composeScript = path.join(installedBinDir, 'nerve-compose.js')
    const workspaceDir = path.join('node_modules', 'nerveflow', 'examples', 'minimal-web-host')

    const composableServerPath = path.join(installedRoot, 'examples', 'composable-reference-host', 'server.js')
    const composableReadmePath = path.join(installedRoot, 'examples', 'composable-reference-host', 'README.md')
    if (!existsSync(composableServerPath) || !existsSync(composableReadmePath)) {
      throw new Error('Composable reference host assets are missing from installed npm artifact')
    }

    const minimalWsServerPath = path.join(installedRoot, 'examples', 'minimal-ws-host', 'server.js')
    const minimalWsReadmePath = path.join(installedRoot, 'examples', 'minimal-ws-host', 'README.md')
    const minimalWsPackagePath = path.join(installedRoot, 'examples', 'minimal-ws-host', 'package.json')
    if (!existsSync(minimalWsServerPath) || !existsSync(minimalWsReadmePath) || !existsSync(minimalWsPackagePath)) {
      throw new Error('Minimal WS host assets are missing from installed npm artifact')
    }

    const guideDocPath = path.join(installedRoot, 'docs', 'guide', '03-language-reference.md')
    const projectGenDocPath = path.join(installedRoot, 'docs', 'project-generation', 'project-generator-guide.md')
    const rulesDocPath = path.join(installedRoot, 'NERVEFLOW_AGENT_RULES.md')
    if (!existsSync(guideDocPath) || !existsSync(projectGenDocPath) || !existsSync(rulesDocPath)) {
      throw new Error('Documentation assets required by nerve-compose add docs are missing from installed npm artifact')
    }

    console.log('[pack-smoke] validating installed nerve-compose validate command')
    const validateResult = await runCommand(process.execPath, [
      composeScript,
      'validate',
      'examples/minimal-web-host',
      '--json',
    ], { cwd: installedRoot })
    const validatePayload = JSON.parse(String(validateResult.stdout || '{}'))
    if (validatePayload?.ok !== true || validatePayload?.command !== 'validate') {
      throw new Error(`Validate command failed in installed package: ${JSON.stringify(validatePayload)}`)
    }

    console.log('[pack-smoke] booting installed runtime artifact')
    runtimeChild = spawn(process.execPath, [
      runtimeScript,
      'start',
      workspaceDir,
      '--entrypoint',
      'workflow.nrv',
      '--port',
      String(port),
    ], {
      cwd: tempRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    await waitForOutput(runtimeChild, 'nerve-runtime listening at')

    console.log('[pack-smoke] validating /health endpoint')
    const healthResponse = await fetch(`http://127.0.0.1:${port}/health`)
    const healthPayload = await healthResponse.json()
    if (!healthResponse.ok || healthPayload?.ok !== true) {
      throw new Error(`Health endpoint failed: status=${healthResponse.status} payload=${JSON.stringify(healthPayload)}`)
    }

    console.log('[pack-smoke] validating attach snapshot command')
    const attachResult = await runCommand(process.execPath, [
      attachScript,
      `ws://127.0.0.1:${port}/api/runtime/ws`,
      'snapshot',
    ], { cwd: tempRoot })
    const attachPayload = parseAttachResponseOrThrow(attachResult.stdout, 'snapshot')
    if (attachPayload?.ok !== true || attachPayload?.data?.running !== true) {
      throw new Error(`Snapshot response invalid: ${JSON.stringify(attachPayload)}`)
    }

    console.log('[pack-smoke] validating ingress endpoint shape')
    const ingressResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/ingress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'missing_ingress', value: 'smoke' }),
    })
    const ingressPayload = await ingressResponse.json().catch(() => ({}))
    if (ingressResponse.status !== 400 || ingressPayload?.ok !== false) {
      throw new Error(`Ingress endpoint mismatch: status=${ingressResponse.status} payload=${JSON.stringify(ingressPayload)}`)
    }

    console.log('[pack-smoke] success')
  } finally {
    await stopChild(runtimeChild)
    if (tarballName) {
      try {
        await rm(path.join(REPO_ROOT, tarballName), { force: true })
      } catch {}
    }
    await rm(tempRoot, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`[pack-smoke] failed: ${String(error?.message ?? error)}`)
  process.exit(1)
})
