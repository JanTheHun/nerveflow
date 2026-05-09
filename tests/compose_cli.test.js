import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function runProcess(args) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env },
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

    child.once('exit', (code, signal) => {
      resolveRun({ code, signal, stdout, stderr })
    })
  })
}

test('nerve-compose exits with argument error when subcommand is missing', async () => {
  const result = await runProcess(['bin/nerve-compose.js'])
  assert.equal(result.code, 2)
  assert.equal(result.stderr.includes('nerve-compose argument error'), true)
})

test('nerve-compose modules --json returns composition payload', async () => {
  const result = await runProcess(['bin/nerve-compose.js', 'modules', '--json'])
  assert.equal(result.code, 0)

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.command, 'modules')
  assert.equal(typeof payload.workspaceDir, 'string')
  assert.equal(typeof payload.builtinOnly, 'boolean')
  assert.equal(typeof payload.totals?.toolProviders, 'number')
  assert.equal(Array.isArray(payload.sources), true)

  const builtin = payload.sources.find((source) => source?.name === 'builtin')
  assert.equal(Boolean(builtin), true)
  assert.equal(typeof builtin.counts?.toolProviders, 'number')
})

test('nerve-compose modules --builtin-only excludes non-builtin sources', async () => {
  const result = await runProcess(['bin/nerve-compose.js', 'modules', '--builtin-only', '--json'])
  assert.equal(result.code, 0)

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.builtinOnly, true)
  assert.equal(Array.isArray(payload.sources), true)
  assert.equal(payload.sources.length, 1)
  assert.equal(payload.sources[0].name, 'builtin')
})

test('nerve-compose doctor --json returns health report for example workspace', async () => {
  const result = await runProcess(['bin/nerve-compose.js', 'doctor', 'examples/mqtt-simple-host', '--json'])
  assert.equal(result.code, 0)

  const payload = JSON.parse(result.stdout)
  assert.equal(payload.ok, true)
  assert.equal(payload.command, 'doctor')
  assert.equal(typeof payload.effectsPolicy, 'string')
  assert.equal(typeof payload.summary?.errors, 'number')
  assert.equal(Array.isArray(payload.issues), true)
  assert.equal(typeof payload.config?.nextv, 'string')
})

test('nerve-compose doctor fails strict capability checks for missing bindings', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-compose-doctor-'))
  const nextvPath = path.join(workspaceRoot, 'nextv.json')
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(nextvPath, JSON.stringify({
    effectsPolicy: 'strict',
    requires: {
      memory: {
        required: true,
      },
    },
    modules: {},
  }, null, 2), 'utf8')

  try {
    const result = await runProcess(['bin/nerve-compose.js', 'doctor', workspaceRelativePath, '--json'])
    assert.equal(result.code, 1)

    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, false)
    assert.equal(payload.effectsPolicy, 'strict')
    const hasMissingBinding = payload.issues.some((issue) => String(issue.code) === 'MISSING_BINDING')
    assert.equal(hasMissingBinding, true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('nerve-compose add memory-pgvector scaffolds workspace files', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-compose-add-'))
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(path.join(workspaceRoot, 'nextv.json'), JSON.stringify({
    entrypointPath: 'entry.nrv',
    externals: ['user_message'],
  }, null, 2), 'utf8')

  try {
    const result = await runProcess(['bin/nerve-compose.js', 'add', 'memory-pgvector', workspaceRelativePath, '--json'])
    assert.equal(result.code, 0)

    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.command, 'add')
    assert.equal(payload.capability, 'memory-pgvector')
    assert.equal(Array.isArray(payload.files), true)

    const hostModulesSource = await readFile(path.join(workspaceRoot, 'host_modules', 'index.js'), 'utf8')
    const expectedImportPathRaw = path.relative(
      path.join(workspaceRoot, 'host_modules'),
      path.join(process.cwd(), 'src', 'host_modules', 'public', 'index.js'),
    ).replace(/\\/g, '/')
    const expectedImportPath = expectedImportPathRaw.startsWith('.')
      ? expectedImportPathRaw
      : `./${expectedImportPathRaw}`
    assert.equal(hostModulesSource.includes('Generated by nerve-compose add memory-pgvector'), true)
    assert.equal(hostModulesSource.includes('createMemoryProvider'), true)
    assert.equal(hostModulesSource.includes(`from '${expectedImportPath}'`), true)

    const envExample = await readFile(path.join(workspaceRoot, '.env.example'), 'utf8')
    assert.equal(envExample.includes('MEMORY_DB_URL='), true)
    assert.equal(envExample.includes('MEMORY_EMBEDDING_MODEL='), true)

    const nextvRaw = await readFile(path.join(workspaceRoot, 'nextv.json'), 'utf8')
    const nextv = JSON.parse(nextvRaw)
    assert.deepEqual(nextv.requires?.memory, { required: true, provider: 'memory' })
    assert.deepEqual(nextv.modules?.memory, { provider: 'memory-pgvector', mode: 'embedded' })
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('nerve-compose add memory-pgvector is idempotent on rerun', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-compose-add-'))
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(path.join(workspaceRoot, 'nextv.json'), JSON.stringify({ entrypointPath: 'entry.nrv' }, null, 2), 'utf8')

  try {
    const first = await runProcess(['bin/nerve-compose.js', 'add', 'memory-pgvector', workspaceRelativePath, '--json'])
    assert.equal(first.code, 0)

    const second = await runProcess(['bin/nerve-compose.js', 'add', 'memory-pgvector', workspaceRelativePath, '--json'])
    assert.equal(second.code, 0)

    const payload = JSON.parse(second.stdout)
    const actions = payload.files.map((entry) => entry.action)
    assert.equal(actions.every((action) => action === 'unchanged' || action === 'updated' || action === 'skipped'), true)

    const envExample = await readFile(path.join(workspaceRoot, '.env.example'), 'utf8')
    const dbUrlMatches = envExample.match(/MEMORY_DB_URL=/g) || []
    assert.equal(dbUrlMatches.length, 1)

    const hostModulesSource = await readFile(path.join(workspaceRoot, 'host_modules', 'index.js'), 'utf8')
    const createMemoryProviderMatches = hostModulesSource.match(/createMemoryProvider/g) || []
    assert.equal(createMemoryProviderMatches.length, 2)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('nerve-compose add memory-pgvector becomes visible in modules after env is provided', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), 'workspaces-local', '.tmp-compose-add-'))
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(path.join(workspaceRoot, 'nextv.json'), JSON.stringify({ entrypointPath: 'entry.nrv' }, null, 2), 'utf8')

  try {
    const addResult = await runProcess(['bin/nerve-compose.js', 'add', 'memory-pgvector', workspaceRelativePath, '--json'])
    assert.equal(addResult.code, 0)

    await writeFile(path.join(workspaceRoot, '.env'), 'MEMORY_DB_URL=postgres://example/test\n', 'utf8')

    const modulesResult = await runProcess(['bin/nerve-compose.js', 'modules', workspaceRelativePath, '--json'])
    assert.equal(modulesResult.code, 0)

    const payload = JSON.parse(modulesResult.stdout)
    const workspaceSource = payload.sources.find((source) => source?.name === 'workspace')
    assert.equal(Boolean(workspaceSource), true)
    assert.equal(Number(workspaceSource.counts?.toolProviders) > 0, true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('nerve-compose add speech scaffolds env, nextv config, and speech surface', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-compose-speech-'))
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(path.join(workspaceRoot, 'nextv.json'), JSON.stringify({ entrypointPath: 'entry.nrv' }, null, 2), 'utf8')

  try {
    const result = await runProcess(['bin/nerve-compose.js', 'add', 'speech', workspaceRelativePath, '--json'])
    assert.equal(result.code, 0)

    const payload = JSON.parse(result.stdout)
    assert.equal(payload.ok, true)
    assert.equal(payload.capability, 'speech')
    assert.equal(Array.isArray(payload.files), true)

    const hostModulesSource = await readFile(path.join(workspaceRoot, 'host_modules', 'index.js'), 'utf8')
    assert.equal(hostModulesSource.includes('Generated by nerve-compose add speech'), true)
    assert.equal(hostModulesSource.includes('createWhisperIngressConnector'), true)
    assert.equal(hostModulesSource.includes('createPiperEffectRealizer'), true)

    const envExample = await readFile(path.join(workspaceRoot, '.env.example'), 'utf8')
    assert.equal(envExample.includes('WHISPER_RUN_PATH='), true)
    assert.equal(envExample.includes('PIPER_RUN_PATH='), true)
    assert.equal(envExample.includes('VOICE_TRANSPORT_MODE='), true)

    const nextvRaw = await readFile(path.join(workspaceRoot, 'nextv.json'), 'utf8')
    const nextv = JSON.parse(nextvRaw)
    assert.deepEqual(nextv.requires?.speech, { required: true, provider: 'speech' })
    assert.deepEqual(nextv.modules?.speech, { provider: 'speech-surface', mode: 'embedded' })

    const speechSurfaceServer = await readFile(path.join(workspaceRoot, 'speech-surface', 'server.js'), 'utf8')
    assert.equal(speechSurfaceServer.includes('/api/voice-command'), true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})

test('nerve-compose add speech is idempotent on rerun', async () => {
  const workspaceRoot = await mkdtemp(path.join(process.cwd(), '.tmp-compose-speech-'))
  const workspaceRelativePath = path.relative(process.cwd(), workspaceRoot).replace(/\\/g, '/')

  await writeFile(path.join(workspaceRoot, 'nextv.json'), JSON.stringify({ entrypointPath: 'entry.nrv' }, null, 2), 'utf8')

  try {
    const first = await runProcess(['bin/nerve-compose.js', 'add', 'speech', workspaceRelativePath, '--json'])
    assert.equal(first.code, 0)

    const second = await runProcess(['bin/nerve-compose.js', 'add', 'speech', workspaceRelativePath, '--json'])
    assert.equal(second.code, 0)

    const payload = JSON.parse(second.stdout)
    const actions = payload.files.map((entry) => entry.action)
    assert.equal(actions.includes('created'), false)
    assert.equal(actions.every((action) => action === 'unchanged' || action === 'updated' || action === 'skipped'), true)
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
