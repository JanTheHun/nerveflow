import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlamaCppTransport, createOpenAICompatTransport, createOllamaTransport } from '../src/host_core/agent_transports/index.js'

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

test('createOllamaTransport forwards keep_alive and options from transport config', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, opts = {}) => {
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.2',
        message: { role: 'assistant', content: 'hello' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 3,
        total_duration: 1000000,
        load_duration: 100000,
        prompt_eval_duration: 200000,
        eval_duration: 700000,
        created_at: '2024-01-01T00:00:00Z',
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createOllamaTransport({ timeoutMs: 5000 })
    await callAgent({
      model: 'llama3.2',
      messages: [{ role: 'user', content: 'ping' }],
      transport: { provider: 'ollama', keep_alive: '30m', options: { num_ctx: 8192, temperature: 0.5 } },
    })
    assert.equal(capturedBody.keep_alive, '30m')
    assert.deepEqual(capturedBody.options, { num_ctx: 8192, temperature: 0.5 })
  })
})

test('createOllamaTransport ignores transport config when not provided', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, opts = {}) => {
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'llama3.2',
        message: { role: 'assistant', content: 'hello' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 3,
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createOllamaTransport({ timeoutMs: 5000 })
    await callAgent({ model: 'llama3.2', messages: [{ role: 'user', content: 'ping' }] })
    assert.equal(capturedBody.keep_alive, undefined)
    assert.equal(capturedBody.options, undefined)
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

test('createOllamaTransport exposes capabilities.supports_preload=true', () => {
  const callAgent = createOllamaTransport({})
  assert.equal(callAgent.capabilities?.supports_preload, true)
  assert.equal(typeof callAgent.load, 'function')
})

test('createLlamaCppTransport exposes capabilities.supports_preload=false', () => {
  const callAgent = createLlamaCppTransport({})
  assert.equal(callAgent.capabilities?.supports_preload, false)
  assert.equal(typeof callAgent.load, 'undefined')
})

test('createOllamaTransport.load sends empty messages and returns ok', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, opts = {}) => {
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createOllamaTransport({ timeoutMs: 5000 })
    const result = await callAgent.load({ model: 'llama3.2' })
    assert.equal(result.ok, true)
    assert.equal(result.model, 'llama3.2')
    assert.deepEqual(capturedBody.messages, [])
    assert.equal(capturedBody.model, 'llama3.2')
  })
})

// ── openai_compat transport ──────────────────────────────────────────────────

const OPENAI_COMPAT_MOCK_RESPONSE = {
  id: 'chatcmpl-abc',
  object: 'chat.completion',
  created: 1710000000,
  model: 'gpt-4o',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
  usage: { prompt_tokens: 8, completion_tokens: 1, total_tokens: 9 },
}

test('createOpenAICompatTransport returns parsed text + metadata envelope', async () => {
  await withFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => OPENAI_COMPAT_MOCK_RESPONSE,
    text: async () => '',
  }), async () => {
    const callAgent = createOpenAICompatTransport({ baseUrl: 'https://api.openai.com', apiKey: 'sk-test', timeoutMs: 5000 })
    const result = await callAgent({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })

    assert.equal(result.text, 'hello')
    assert.equal(result.metadata.provider, 'openai_compat')
    assert.equal(result.metadata.usage.promptTokens, 8)
    assert.equal(result.metadata.usage.totalTokens, 9)
    assert.equal(result.metadata.rawProvider.finishReason, 'stop')
  })
})

test('createOpenAICompatTransport sends Authorization header when apiKey is set', async () => {
  let capturedHeaders = null
  await withFetchMock(async (_url, fetchOpts = {}) => {
    capturedHeaders = fetchOpts.headers
    return { ok: true, status: 200, json: async () => OPENAI_COMPAT_MOCK_RESPONSE, text: async () => '' }
  }, async () => {
    const callAgent = createOpenAICompatTransport({ apiKey: 'sk-secret', timeoutMs: 5000 })
    await callAgent({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })

    assert.equal(capturedHeaders?.['Authorization'], 'Bearer sk-secret')
  })
})

test('createOpenAICompatTransport omits Authorization header when no apiKey', async () => {
  let capturedHeaders = null
  await withFetchMock(async (_url, fetchOpts = {}) => {
    capturedHeaders = fetchOpts.headers
    return { ok: true, status: 200, json: async () => OPENAI_COMPAT_MOCK_RESPONSE, text: async () => '' }
  }, async () => {
    const callAgent = createOpenAICompatTransport({ timeoutMs: 5000 })
    await callAgent({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] })

    assert.equal(capturedHeaders?.['Authorization'], undefined)
  })
})

test('createOpenAICompatTransport overrides apiKey and baseUrl from per-call transport config', async () => {
  let capturedUrl = null
  let capturedHeaders = null
  await withFetchMock(async (url, fetchOpts = {}) => {
    capturedUrl = url
    capturedHeaders = fetchOpts.headers
    return { ok: true, status: 200, json: async () => OPENAI_COMPAT_MOCK_RESPONSE, text: async () => '' }
  }, async () => {
    const callAgent = createOpenAICompatTransport({ apiKey: 'sk-static', timeoutMs: 5000 })
    await callAgent({
      model: 'mistral',
      messages: [{ role: 'user', content: 'hi' }],
      transport: { apiKey: 'sk-override', baseUrl: 'https://api.groq.com' },
    })

    assert.equal(capturedUrl, 'https://api.groq.com/v1/chat/completions')
    assert.equal(capturedHeaders?.['Authorization'], 'Bearer sk-override')
  })
})

test('createOpenAICompatTransport times out with AGENT_TRANSPORT_TIMEOUT', async () => {
  await withFetchMock((_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }, { once: true })
  }), async () => {
    const callAgent = createOpenAICompatTransport({ apiKey: 'sk-test', timeoutMs: 5 })

    await assert.rejects(
      () => callAgent({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
      (err) => {
        assert.equal(err.code, 'AGENT_TRANSPORT_TIMEOUT')
        assert.match(err.message, /timed out/i)
        return true
      },
    )
  })
})

test('createOpenAICompatTransport exposes capabilities.supports_preload=false', () => {
  const callAgent = createOpenAICompatTransport({})
  assert.equal(callAgent.capabilities.supports_preload, false)
})
