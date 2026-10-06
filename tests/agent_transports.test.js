import test from 'node:test'
import assert from 'node:assert/strict'
import { createLlamaCppTransport, createOpenAICompatTransport, createOllamaTransport, createSystemOneTransport } from '../src/host_core/agent_transports/index.js'

function withFetchMock(mockFn, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFn
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = originalFetch
    })
}

function createAbortableBodyReader(signal, readValue) {
  return () => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
      return
    }

    const onAbort = () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    Promise.resolve()
      .then(readValue)
      .then((value) => {
        signal?.removeEventListener?.('abort', onAbort)
        resolve(value)
      })
      .catch((err) => {
        signal?.removeEventListener?.('abort', onAbort)
        reject(err)
      })
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

test('createOllamaTransport forwards tools payload, normalizes tool history, and extracts tool calls metadata', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, opts = {}) => {
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: 'qwen2.5:3b',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            function: {
              name: 'get_time',
              arguments: { timeZone: 'UTC' },
            },
          }],
        },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 5,
        eval_count: 3,
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createOllamaTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'qwen2.5:3b',
      messages: [
        { role: 'user', content: 'what time is it?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: 'get_time',
              arguments: '{"timeZone":"UTC"}',
            },
          }],
        },
        {
          role: 'tool',
          tool_call_id: 'call_123',
          name: 'get_time',
          content: '{"iso":"2026-05-12T00:00:00.000Z"}',
        },
      ],
      tools: [{ type: 'function', function: { name: 'get_time', parameters: { type: 'object' }, _schemaSource: 'native' } }],
    })

    assert.equal(Array.isArray(capturedBody.tools), true)
    assert.equal(capturedBody.tools[0].function.name, 'get_time')
    assert.equal(capturedBody.tools[0].function._schemaSource, undefined)
    assert.equal(capturedBody.messages[1].tool_calls[0].function.name, 'get_time')
    assert.deepEqual(capturedBody.messages[1].tool_calls[0].function.arguments, { timeZone: 'UTC' })
    assert.equal(capturedBody.messages[2].role, 'tool')
    assert.equal(capturedBody.messages[2].tool_name, 'get_time')
    assert.equal(capturedBody.messages[2].tool_call_id, undefined)

    assert.equal(Array.isArray(result.metadata.toolCalls), true)
    assert.equal(result.metadata.toolCalls.length, 1)
    assert.equal(result.metadata.toolCalls[0].id, 'tool-call-1')
    assert.equal(result.metadata.toolCalls[0].name, 'get_time')
    assert.equal(result.metadata.toolCalls[0].argumentsRaw, '{"timeZone":"UTC"}')
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

test('createOllamaTransport times out when response body hangs after headers', async () => {
  await withFetchMock(async (_url, options = {}) => ({
    ok: true,
    status: 200,
    json: createAbortableBodyReader(options.signal, async () => new Promise(() => {})),
    text: createAbortableBodyReader(options.signal, async () => ''),
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

// ── experimental System One transport ──────────────────────────────────────

test('createSystemOneTransport maps a bounded decision to the System One choice API', async () => {
  let capturedUrl = null
  let capturedHeaders = null
  let capturedBody = null
  await withFetchMock(async (url, opts = {}) => {
    capturedUrl = url
    capturedHeaders = opts.headers
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => name === 'x-typesafe-request-id' ? 'request-123' : null },
      json: async () => ({
        model: 'tev1:4b',
        answers: {
          decision: {
            type: 'choice',
            choice: 'refund',
            confidence: 0.9801,
            probabilities: { invoice: 0.002, refund: 0.986, other: 0.012 },
          },
        },
        usage: { input_tokens: 42, output_tokens: 0 },
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'tev1:4b',
      transport: { baseUrl: 'http://127.0.0.1:11434/', apiKey: 'local', keep_alive: -1 },
      systemOne: {
        state: 'Can I get an invoice for last month?',
        instructions: 'What does the customer want?',
        options: ['invoice', 'refund', 'other'],
      },
    })

    assert.equal(capturedUrl, 'http://127.0.0.1:11434/v1/systemone')
    assert.equal(capturedHeaders.Authorization, 'Bearer local')
    assert.deepEqual(capturedBody, {
      model: 'tev1:4b',
      state: 'Can I get an invoice for last month?',
      questions: {
        decision: {
          type: 'choice',
          instructions: 'What does the customer want?',
          criteria: { invoice: null, refund: null, other: null },
        },
      },
      keep_alive: -1,
    })
    assert.equal(result.text, 'refund')
    assert.equal(result.metadata.provider, 'experimental.systemone')
    assert.equal(result.metadata.model, 'tev1:4b')
    assert.equal(result.metadata.requestId, 'request-123')
    assert.equal(result.metadata.usage.totalTokens, 42)
    assert.equal(result.metadata.decision.confidence, 0.9801)
    assert.deepEqual(result.metadata.decision.probabilities, { invoice: 0.002, refund: 0.986, other: 0.012 })
  })
})

test('createSystemOneTransport maps typed multi-question decisions and images', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, opts = {}) => {
    capturedBody = JSON.parse(opts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        model: 'clef-flash:9b',
        answers: {
          team: { type: 'choice', choice: 'technical', probabilities: { billing: 0.01, technical: 0.99 }, confidence: 0.98 },
          urgent: { type: 'noul', noul: 0.95 },
          severity: { type: 'score', score: 1.8, legend: { 0: 'Low', 1: 'High', 2: 'Critical' }, probabilities: { 0: 0.05, 1: 0.2, 2: 0.75 }, confidence: 0.65 },
        },
        usage: { input_tokens: 20, output_tokens: 3 },
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'clef-flash:9b',
      systemOne: {
        state: { ticket: 'Checkout has failed for an hour.' },
        images: ['base64-image'],
        questions: {
          team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, technical: null } },
          urgent: { type: 'noul', instructions: 'Is it urgent?' },
          severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'High', 'Critical'] },
        },
      },
    })

    assert.deepEqual(capturedBody.questions, {
      team: { type: 'choice', instructions: 'Which team?', criteria: { billing: null, technical: null } },
      urgent: { type: 'noul', instructions: 'Is it urgent?' },
      severity: { type: 'score', instructions: 'How severe?', criteria: ['Low', 'High', 'Critical'] },
    })
    assert.deepEqual(capturedBody.images, ['base64-image'])
    assert.equal(result.value.team.choice, 'technical')
    assert.equal(result.value.urgent.noul, 0.95)
    assert.equal(result.value.severity.score, 1.8)
    assert.equal(result.metadata.decisions.severity.legend['2'], 'Critical')
  })
})

test('createSystemOneTransport rejects typed answers outside declared criteria', async () => {
  await withFetchMock(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ answers: { route: { type: 'choice', choice: 'unknown' } } }),
    text: async () => '',
  }), async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5000 })
    await assert.rejects(
      () => callAgent({
        model: 'nimble:9b',
        systemOne: { state: 'route me', questions: { route: { type: 'choice', instructions: 'Route?', criteria: { billing: null, other: null } } } },
      }),
      (err) => {
        assert.equal(err.code, 'SYSTEMONE_INVALID_RESPONSE')
        assert.match(err.message, /not a declared criterion/)
        return true
      },
    )
  })
})

test('createSystemOneTransport surfaces provider errors', async () => {
  await withFetchMock(async () => ({
    ok: false,
    status: 422,
    statusText: 'Unprocessable Entity',
    text: async () => '{"error":"state is too long","code":"STATE_TRUNCATED"}',
  }), async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5000 })
    await assert.rejects(
      () => callAgent({
        model: 'tev1:4b',
        systemOne: { state: 'request', instructions: 'Classify it.', options: ['yes', 'no'] },
      }),
      (err) => {
        assert.equal(err.code, 'SYSTEMONE_HTTP_ERROR')
        assert.equal(err.status, 422)
        assert.match(err.message, /STATE_TRUNCATED/)
        return true
      },
    )
  })
})

test('createSystemOneTransport rejects malformed successful responses', async () => {
  await withFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: 'tev1:4b', answers: { decision: { type: 'choice' } } }),
    text: async () => '',
  }), async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5000 })
    await assert.rejects(
      () => callAgent({
        model: 'tev1:4b',
        systemOne: { state: 'request', instructions: 'Classify it.', options: ['yes', 'no'] },
      }),
      (err) => {
        assert.equal(err.code, 'SYSTEMONE_INVALID_RESPONSE')
        assert.match(err.message, /answers\.decision\.choice/)
        return true
      },
    )
  })
})

test('createSystemOneTransport times out with AGENT_TRANSPORT_TIMEOUT', async () => {
  await withFetchMock((_url, options = {}) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }, { once: true })
  }), async () => {
    const callAgent = createSystemOneTransport({ timeoutMs: 5 })
    await assert.rejects(
      () => callAgent({
        model: 'tev1:4b',
        systemOne: { state: 'request', instructions: 'Classify it.', options: ['yes', 'no'] },
      }),
      (err) => {
        assert.equal(err.code, 'AGENT_TRANSPORT_TIMEOUT')
        assert.match(err.message, /timed out/i)
        return true
      },
    )
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

test('createOpenAICompatTransport supports per-call timeout override via timeoutMs and timeout_ms', async () => {
  await withFetchMock((_url, options = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve({ ok: true, status: 200, json: async () => OPENAI_COMPAT_MOCK_RESPONSE, text: async () => '' })
    }, 20)

    options.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      const err = new Error('aborted')
      err.name = 'AbortError'
      reject(err)
    }, { once: true })
  }), async () => {
    const callAgent = createOpenAICompatTransport({ apiKey: 'sk-test', timeoutMs: 5 })

    const resultCamel = await callAgent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      transport: { timeoutMs: 100 },
    })
    assert.equal(resultCamel.text, 'hello')

    const resultSnake = await callAgent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      transport: { timeout_ms: 100 },
    })
    assert.equal(resultSnake.text, 'hello')
  })
})

test('createOpenAICompatTransport exposes capabilities.supports_preload=false', () => {
  const callAgent = createOpenAICompatTransport({})
  assert.equal(callAgent.capabilities.supports_preload, false)
})

test('createOpenAICompatTransport forwards tools payload and extracts tool calls metadata', async () => {
  let capturedBody = null
  await withFetchMock(async (_url, fetchOpts = {}) => {
    capturedBody = JSON.parse(fetchOpts.body ?? 'null')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'chatcmpl-tools',
        object: 'chat.completion',
        created: 1710000010,
        model: 'gpt-4o',
        choices: [{
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              id: 'call_123',
              type: 'function',
              function: {
                name: 'search',
                arguments: '{"q":"nerveflow"}',
              },
            }],
          },
        }],
      }),
      text: async () => '',
    }
  }, async () => {
    const callAgent = createOpenAICompatTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'search docs' }],
      tools: [{ type: 'function', function: { name: 'search', parameters: { type: 'object' }, _schemaSource: 'fallback' } }],
      tool_choice: 'auto',
    })

    assert.equal(Array.isArray(capturedBody.tools), true)
    assert.equal(capturedBody.tools[0].function.name, 'search')
    assert.equal(capturedBody.tools[0].function._schemaSource, undefined)
    assert.equal(capturedBody.tool_choice, 'auto')
    assert.equal(Array.isArray(result.metadata.toolCalls), true)
    assert.equal(result.metadata.toolCalls.length, 1)
    assert.equal(result.metadata.toolCalls[0].id, 'call_123')
    assert.equal(result.metadata.toolCalls[0].name, 'search')
    assert.equal(result.metadata.toolCalls[0].argumentsRaw, '{"q":"nerveflow"}')
  })
})

test('createOpenAICompatTransport preserves object-form tool call arguments', async () => {
  await withFetchMock(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: 'chatcmpl-tools-object-args',
      object: 'chat.completion',
      created: 1710000011,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{
            id: 'call_obj_1',
            type: 'function',
            function: {
              name: 'list_directory',
              arguments: {
                path: 'C:/workspace',
              },
            },
          }],
        },
      }],
    }),
    text: async () => '',
  }), async () => {
    const callAgent = createOpenAICompatTransport({ timeoutMs: 5000 })
    const result = await callAgent({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'list files' }],
    })

    assert.equal(Array.isArray(result.metadata.toolCalls), true)
    assert.equal(result.metadata.toolCalls.length, 1)
    assert.equal(result.metadata.toolCalls[0].name, 'list_directory')
    assert.equal(result.metadata.toolCalls[0].argumentsRaw, '{"path":"C:/workspace"}')
  })
})
