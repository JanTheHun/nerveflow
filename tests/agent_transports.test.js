import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlamaCppTransport, createOllamaTransport } from '../src/host_core/agent_transports/index.js'

function withFetchMock(mockFn, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFn
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = originalFetch
    })
}

test('createLlamaCppTransport returns parsed text + metadata envelope', async () => {
  await withFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1710000000,
      model: 'llama3.1',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'pong' },
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
      },
    }),
    text: async () => '',
  }), async () => {
    const callAgent = createLlamaCppTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'llama3.1',
      messages: [{ role: 'user', content: 'ping' }],
    })

    assert.equal(result.text, 'pong')
    assert.equal(result.metadata.provider, 'llama.cpp')
    assert.equal(result.metadata.usage.totalTokens, 12)
    assert.equal(result.metadata.rawProvider.finishReason, 'stop')
  })
})

test('createLlamaCppTransport times out with AGENT_TRANSPORT_TIMEOUT', async () => {
  await withFetchMock((_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }, { once: true })
  }), async () => {
    const callAgent = createLlamaCppTransport({ timeoutMs: 5 })

    await assert.rejects(
      () => callAgent({ model: 'llama3.1', messages: [{ role: 'user', content: 'ping' }] }),
      (err) => {
        assert.equal(err.code, 'AGENT_TRANSPORT_TIMEOUT')
        assert.match(err.message, /timed out/i)
        return true
      },
    )
  })
})

test('createOllamaTransport times out with AGENT_TRANSPORT_TIMEOUT', async () => {
  await withFetchMock((_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }, { once: true })
  }), async () => {
    const callAgent = createOllamaTransport({ timeoutMs: 5 })

    await assert.rejects(
      () => callAgent({ model: 'llama3.2', messages: [{ role: 'user', content: 'ping' }] }),
      (err) => {
        assert.equal(err.code, 'AGENT_TRANSPORT_TIMEOUT')
        assert.match(err.message, /timed out/i)
        return true
      },
    )
  })
})
