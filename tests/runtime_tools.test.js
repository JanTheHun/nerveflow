import test from 'node:test'
import assert from 'node:assert/strict'

import { createRuntimeBuiltinToolProvider } from '../src/runtime/runtime_tools.js'

test('runtime built-in get_time returns deterministic shape', async () => {
  const provider = createRuntimeBuiltinToolProvider()
  const result = await provider.get_time({ args: { timeZone: 'UTC' } })

  assert.equal(typeof result.iso, 'string')
  assert.equal(typeof result.epochMs, 'number')
  assert.equal(result.timeZone, 'UTC')
})

test('runtime built-in http_fetch returns text and parsed json when content-type is json', async () => {
  const provider = createRuntimeBuiltinToolProvider({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: {
        get: () => 'application/json; charset=utf-8',
      },
      text: async () => '{"ok":true}',
    }),
  })

  const result = await provider.http_fetch({ args: { url: 'https://example.test/api' } })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.equal(result.text, '{"ok":true}')
  assert.deepEqual(result.json, { ok: true })
})

test('runtime built-in rss_fetch parses rss items', async () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>Feed A</title><item><title>First</title><link>https://example.test/1</link><guid>id-1</guid><pubDate>Sun, 26 Apr 2026 10:00:00 GMT</pubDate></item></channel></rss>`
  const provider = createRuntimeBuiltinToolProvider({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/rss+xml' },
      text: async () => xml,
    }),
  })

  const result = await provider.rss_fetch({ args: { url: 'https://example.test/feed.xml', limit: 5 } })
  assert.equal(result.count, 1)
  assert.equal(result.items[0].id, 'id-1')
  assert.equal(result.items[0].title, 'First')
  assert.equal(result.items[0].url, 'https://example.test/1')
})