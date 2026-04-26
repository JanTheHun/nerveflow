import test from 'node:test'
import assert from 'node:assert'
import { loadHostModules } from '../src/host_modules/index.js'
import { createToolRuntime } from '../src/host_core/index.js'
import path from 'node:path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dirname, '..')

test('loadHostModules loads builtin providers', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  assert(Array.isArray(providers), 'providers must be an array')
  assert(providers.length > 0, 'should have at least builtin provider')

  const builtin = providers[0]
  assert(builtin.get_time, 'builtin should have get_time')
  assert(builtin.http_fetch, 'builtin should have http_fetch')
  assert(builtin.rss_fetch, 'builtin should have rss_fetch')
})

test('loadHostModules with missing workspaceDir is non-fatal', async (t) => {
  const providers = await loadHostModules({ workspaceDir: '/nonexistent/path' })
  assert(Array.isArray(providers), 'should still return providers array')
  assert(providers.length > 0, 'builtin provider should be included')
})

test('loadHostModules with builtinOnly skips workspace discovery', async (t) => {
  const providers = await loadHostModules({
    workspaceDir: repoRoot,
    builtinOnly: true,
  })
  assert(Array.isArray(providers), 'providers must be an array')
  // Builtin only, so exactly one provider
  assert(providers.length === 1, 'should have only builtin provider when builtinOnly=true')
})

test('tool runtime dispatches through composed providers (builtin)', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  const toolRuntime = createToolRuntime({ providers })

  const result = await toolRuntime.call({
    name: 'get_time',
  })

  assert(result.iso, 'get_time should return iso timestamp')
  assert(result.epochMs, 'get_time should return epochMs')
  assert(result.timeZone === 'UTC', 'get_time should default to UTC')
})

test('tool runtime throws for unknown tool from composed providers', async (t) => {
  const providers = await loadHostModules({ builtinOnly: true })
  const toolRuntime = createToolRuntime({ providers })

  try {
    await toolRuntime.call({
      name: 'unknown_tool',
    })
    assert.fail('should have thrown unknown-tool error')
  } catch (error) {
    assert(error.message.includes('not available'), 'error should mention tool not available')
  }
})

test('provider ordering: first provider wins for duplicate tool names', async (t) => {
  // Create two providers with overlapping tool names
  const provider1 = {
    test_tool: async ({ name }) => ({ source: 'provider1' }),
  }

  const provider2 = {
    test_tool: async ({ name }) => ({ source: 'provider2' }),
  }

  const toolRuntime = createToolRuntime({ providers: [provider1, provider2] })

  const result = await toolRuntime.call({
    name: 'test_tool',
  })

  assert.strictEqual(result.source, 'provider1', 'first provider should win')
})
