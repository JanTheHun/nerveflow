import test from 'node:test'
import assert from 'node:assert/strict'

import { createToolRuntime } from '../src/host_core/tool_runtime.js'

test('tool runtime dispatches to object-map provider handler', async () => {
  const runtime = createToolRuntime({
    providers: [
      {
        get_time: async ({ args }) => ({ ok: true, tz: String(args?.tz ?? 'utc') }),
      },
    ],
  })

  const result = await runtime.call({ name: 'get_time', args: { tz: 'est' } })
  assert.deepEqual(result, { ok: true, tz: 'est' })
})

test('tool runtime falls through function provider to next provider', async () => {
  const runtime = createToolRuntime({
    providers: [
      async ({ name }) => {
        if (name === 'unknown') return { handled: true, result: { ok: false } }
        return { handled: false }
      },
      {
        ping: async () => ({ ok: true, pong: true }),
      },
    ],
  })

  const result = await runtime.call({ name: 'ping' })
  assert.deepEqual(result, { ok: true, pong: true })
})

test('tool runtime throws deterministic error for unknown tools', async () => {
  const runtime = createToolRuntime({ providers: [] })
  await assert.rejects(
    () => runtime.call({ name: 'not_implemented' }),
    /Tool "not_implemented" is not available in this host yet\./,
  )
})

test('tool runtime falls through object provider when handler returns handled:false', async () => {
  const runtime = createToolRuntime({
    providers: [
      {
        ping: async () => ({ handled: false, ok: false, error: 'not here' }),
      },
      {
        ping: async () => ({ ok: true, pong: true }),
      },
    ],
  })

  const result = await runtime.call({ name: 'ping' })
  assert.deepEqual(result, { ok: true, pong: true })
})

test('tool runtime returns wrapped result when object provider signals handled:true', async () => {
  let nextProviderCalled = false
  const runtime = createToolRuntime({
    providers: [
      {
        ping: async () => ({ handled: true, result: { ok: true, source: 'first' } }),
      },
      {
        ping: async () => {
          nextProviderCalled = true
          return { ok: true, source: 'second' }
        },
      },
    ],
  })

  const result = await runtime.call({ name: 'ping' })
  assert.deepEqual(result, { ok: true, source: 'first' })
  assert.equal(nextProviderCalled, false)
})