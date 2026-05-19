import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  storageCapability,
  localVectorProvider,
  resolveLocalVectorConfig,
  fileStoreProvider,
} from '../src/host_core/index.js'

function withTemporaryEnv(updates, fn) {
  const keys = Object.keys(updates)
  const original = new Map(keys.map((key) => [key, process.env[key]]))

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === null) {
      delete process.env[key]
    } else {
      process.env[key] = String(value)
    }
  }

  try {
    return fn()
  } finally {
    for (const key of keys) {
      const prior = original.get(key)
      if (prior === undefined) delete process.env[key]
      else process.env[key] = prior
    }
  }
}

test('storageCapability returns capability with toolProviders', () => {
  const provider = {
    memory_store: async () => ({ ok: true }),
  }

  const capability = storageCapability({ provider })

  assert.equal(Array.isArray(capability.toolProviders), true)
  assert.equal(capability.toolProviders.length, 1)
  assert.equal(capability.toolProviders[0], provider)
})

test('storageCapability requires provider', () => {
  assert.throws(
    () => storageCapability({}),
    /requires a provider/i,
  )
})

test('storageCapability rejects invalid provider', () => {
  assert.throws(
    () => storageCapability({ provider: 'not-an-object' }),
    /provider must be an object/i,
  )
})

test('localVectorProvider returns object with expected tool names', () => {
  const provider = localVectorProvider({
    pgUrl: 'postgresql://user:pass@localhost/db',
  })

  assert.equal(typeof provider, 'object')
  assert.equal(typeof provider.memory_store, 'function')
  assert.equal(typeof provider.memory_retrieve, 'function')
  assert.equal(typeof provider.memory_delete, 'function')
  assert.equal(typeof provider.memory_update, 'function')
})

test('resolveLocalVectorConfig reads values from env', () => {
  withTemporaryEnv({
    MEMORY_DB_URL: 'postgresql://env-user:env-pass@localhost/env_db',
    MEMORY_EMBEDDING_MODEL: 'env-embed-model',
    MEMORY_EMBEDDING_BASE_URL: 'http://127.0.0.1:11435',
    MEMORY_EMBEDDING_DIMENSIONS: '768',
    MEMORY_POOL_MIN: '3',
    MEMORY_POOL_MAX: '11',
  }, () => {
    const cfg = resolveLocalVectorConfig()

    assert.equal(cfg.pgUrl, 'postgresql://env-user:env-pass@localhost/env_db')
    assert.equal(cfg.embeddingModel, 'env-embed-model')
    assert.equal(cfg.embeddingBaseUrl, 'http://127.0.0.1:11435')
    assert.equal(cfg.embeddingDimensions, 768)
    assert.equal(cfg.poolMin, 3)
    assert.equal(cfg.poolMax, 11)
  })
})

test('resolveLocalVectorConfig applies explicit overrides over env', () => {
  withTemporaryEnv({
    MEMORY_DB_URL: 'postgresql://env-host/env_db',
    MEMORY_EMBEDDING_MODEL: 'env-model',
    MEMORY_EMBEDDING_BASE_URL: 'http://127.0.0.1:11435',
    MEMORY_EMBEDDING_DIMENSIONS: '768',
    MEMORY_POOL_MIN: '3',
    MEMORY_POOL_MAX: '11',
  }, () => {
    const cfg = resolveLocalVectorConfig({
      pgUrl: 'postgresql://override-host/override_db',
      embeddingModel: 'override-model',
      embeddingBaseUrl: 'http://127.0.0.1:11439',
      embeddingDimensions: 384,
      poolMin: 1,
      poolMax: 6,
    })

    assert.equal(cfg.pgUrl, 'postgresql://override-host/override_db')
    assert.equal(cfg.embeddingModel, 'override-model')
    assert.equal(cfg.embeddingBaseUrl, 'http://127.0.0.1:11439')
    assert.equal(cfg.embeddingDimensions, 384)
    assert.equal(cfg.poolMin, 1)
    assert.equal(cfg.poolMax, 6)
  })
})

test('resolveLocalVectorConfig falls back to defaults for invalid numerics', () => {
  const cfg = resolveLocalVectorConfig({
    pgUrl: 'postgresql://defaults-user:defaults-pass@localhost/defaults_db',
    embeddingDimensions: 'not-a-number',
    poolMin: 'nope',
    poolMax: null,
  })

  assert.equal(cfg.embeddingDimensions, 384)
  assert.equal(cfg.poolMin, 2)
  assert.equal(cfg.poolMax, 10)
})

test('fileStoreProvider returns object with expected tool names', () => {
  const provider = fileStoreProvider()

  assert.equal(typeof provider, 'object')
  assert.equal(typeof provider.store_file_json, 'function')
})
