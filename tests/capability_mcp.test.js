import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  mcpCapability,
} from '../src/host_core/index.js'

test('mcpCapability requires servers array', () => {
  assert.throws(
    () => mcpCapability({ servers: 'not-an-array' }),
    /servers must be an array/i,
  )
})

test('mcpCapability accepts empty servers array', () => {
  const capability = mcpCapability({ servers: [] })

  assert.equal(Array.isArray(capability.toolProviders), true)
  assert.equal(capability.toolProviders.length, 0)
})

test('mcpCapability rejects server without name', () => {
  assert.throws(
    () => mcpCapability({
      servers: [
        {
          transport: 'stdio',
          config: { command: 'echo' },
        },
      ],
    }),
    /requires name/i,
  )
})

test('mcpCapability rejects server without transport', () => {
  assert.throws(
    () => mcpCapability({
      servers: [
        {
          name: 'test-server',
          config: { command: 'echo' },
        },
      ],
    }),
    /requires transport/i,
  )
})

test('mcpCapability rejects server without config', () => {
  assert.throws(
    () => mcpCapability({
      servers: [
        {
          name: 'test-server',
          transport: 'stdio',
        },
      ],
    }),
    /requires config/i,
  )
})

test('mcpCapability creates tool provider for each server', () => {
  const capability = mcpCapability({
    servers: [
      {
        name: 'database',
        transport: 'stdio',
        config: { command: 'python' },
      },
      {
        name: 'weather',
        transport: 'stdio',
        config: { command: 'node' },
      },
    ],
  })

  assert.equal(capability.toolProviders.length, 2)
  assert.equal(typeof capability.toolProviders[0], 'object')
  assert.equal(typeof capability.toolProviders[1], 'object')
})

test('mcpCapability with default empty servers', () => {
  const capability = mcpCapability()

  assert.equal(Array.isArray(capability.toolProviders), true)
  assert.equal(capability.toolProviders.length, 0)
})
