import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  applySetup,
  LOCAL_ENV_FILENAME,
  upsertEnvValues,
  resolveRegistryWriteTarget,
} = require('../extensions/vscode-conversation-composer/src/setupManager.js')

test('resolveRegistryWriteTarget prefers inline when key exists in root config', () => {
  const target = resolveRegistryWriteTarget({
    rootConfigPath: '/tmp/nerve.json',
    rootConfig: { transports: { local: { provider: 'ollama' } } },
    standalonePath: '/tmp/transports.json',
    key: 'transports',
  })

  assert.equal(target.kind, 'inline')
  assert.equal(target.path, '/tmp/nerve.json')
})

test('upsertEnvValues appends only missing keys', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-setup-env-'))
  try {
    await writeFile(path.join(workspace, LOCAL_ENV_FILENAME), JSON.stringify({ OPENAI_API_KEY: 'old' }, null, 2), 'utf8')
    const result = await upsertEnvValues(workspace, [
      { key: 'OPENAI_API_KEY', value: 'new' },
      { key: 'OPENAI_BASE_URL', value: 'http://localhost:11434/v1' },
    ])

    assert.equal(result.updated, true)
    assert.deepEqual(result.appendedKeys, ['OPENAI_BASE_URL'])

    const envRaw = JSON.parse(await readFile(path.join(workspace, LOCAL_ENV_FILENAME), 'utf8'))
    assert.equal(envRaw.OPENAI_API_KEY, 'old')
    assert.equal(envRaw.OPENAI_BASE_URL, 'http://localhost:11434/v1')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('applySetup preserves inline style in nerve.json when transports/models inline already exist', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-setup-inline-'))
  try {
    const rootPath = path.join(workspace, 'nerve.json')
    await writeFile(rootPath, JSON.stringify({
      transports: {
        existing: { provider: 'ollama' },
      },
      models: {
        existing: { transport: 'existing', model: 'qwen3' },
      },
    }, null, 2), 'utf8')

    await applySetup(workspace, {
      provider: 'openai_compat',
      transportName: 'openai-local',
      modelAlias: 'coder-local',
      model: 'qwen3-coder',
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKeyEnvVar: 'OPENAI_API_KEY',
      apiKeyValue: 'test-key',
    })

    const rootRaw = JSON.parse(await readFile(rootPath, 'utf8'))
    assert.equal(rootRaw.transports['openai-local'].provider, 'openai_compat')
    assert.equal(rootRaw.models['coder-local'].transport, 'openai-local')
    assert.equal(rootRaw.models['coder-local'].model, 'qwen3-coder')

    const envRaw = JSON.parse(await readFile(path.join(workspace, LOCAL_ENV_FILENAME), 'utf8'))
    assert.equal(envRaw.OPENAI_API_KEY, 'test-key')
    assert.equal(envRaw.OPENAI_LOCAL_BASE_URL, 'http://127.0.0.1:11434/v1')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('applySetup writes standalone registry files when root has no inline maps', async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'composer-setup-standalone-'))
  try {
    await writeFile(path.join(workspace, 'nerve.json'), JSON.stringify({ entrypointPath: 'workflow.nrv' }, null, 2), 'utf8')

    await applySetup(workspace, {
      provider: 'ollama',
      transportName: 'ollama-local',
      modelAlias: 'ollama-coder',
      model: 'qwen3-coder',
      baseUrl: 'http://127.0.0.1:11434',
    })

    const transports = JSON.parse(await readFile(path.join(workspace, 'transports.json'), 'utf8'))
    const models = JSON.parse(await readFile(path.join(workspace, 'models.json'), 'utf8'))

    assert.equal(transports['ollama-local'].provider, 'ollama')
    assert.equal(models['ollama-coder'].transport, 'ollama-local')
    assert.equal(models['ollama-coder'].model, 'qwen3-coder')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
