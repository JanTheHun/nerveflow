import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostAdapter } from '../src/host_core/runtime_session.js'
import { createToolRuntime } from '../src/host_core/tool_runtime.js'

function buildAdapter(workspaceConfig, options = {}) {
  return createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig,
    callAgent: async () => 'ok',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    toolRuntime: options.toolRuntime ?? null,
  })
}

test('callTool resolves alias before allow-list checks', async () => {
  const adapter = buildAdapter({
    tools: {
      allow: new Set(['real_tool']),
      aliases: { alias_tool: 'real_tool' },
    },
    agents: { profiles: {} },
    operators: { map: {} },
  })

  await assert.rejects(
    () => adapter.callTool({ name: 'alias_tool' }),
    (err) => {
      assert.match(err.message, /Tool "real_tool" is not available in this host yet\./)
      return true
    },
  )
})

test('callTool denies tools outside allow-list after alias resolution', async () => {
  const adapter = buildAdapter({
    tools: {
      allow: new Set(['safe_tool']),
      aliases: { alias_tool: 'blocked_tool' },
    },
    agents: { profiles: {} },
    operators: { map: {} },
  })

  await assert.rejects(
    () => adapter.callTool({ name: 'alias_tool' }),
    (err) => {
      assert.match(err.message, /Tool "alias_tool" is not allowed by workspace tools policy\./)
      return true
    },
  )
})

test('callTool resolves alias chains before allow-list checks', async () => {
  const adapter = buildAdapter({
    tools: {
      allow: new Set(['leaf_tool']),
      aliases: {
        first_alias: 'second_alias',
        second_alias: 'leaf_tool',
      },
    },
    agents: { profiles: {} },
    operators: { map: {} },
  })

  await assert.rejects(
    () => adapter.callTool({ name: 'first_alias' }),
    (err) => {
      assert.match(err.message, /Tool "leaf_tool" is not available in this host yet\./)
      return true
    },
  )
})

test('callTool reports unavailable when allow-list is not configured', async () => {
  const adapter = buildAdapter({
    tools: {
      allow: null,
      aliases: {},
    },
    agents: { profiles: {} },
    operators: { map: {} },
  })

  await assert.rejects(
    () => adapter.callTool({ name: 'get_time' }),
    (err) => {
      assert.match(err.message, /Tool "get_time" is not available in this host yet\./)
      return true
    },
  )
})

test('callTool dispatches to configured tool runtime after alias resolution', async () => {
  const calls = []
  const toolRuntime = createToolRuntime({
    providers: [
      {
        real_tool: async (payload) => {
          calls.push(payload)
          return { ok: true, handledBy: 'real_tool' }
        },
      },
    ],
  })

  const adapter = buildAdapter({
    tools: {
      allow: new Set(['real_tool']),
      aliases: { alias_tool: 'real_tool' },
    },
    agents: { profiles: {} },
    operators: { map: {} },
  }, { toolRuntime })

  const result = await adapter.callTool({
    name: 'alias_tool',
    args: { sample: true },
    positional: ['x'],
    state: { on: true },
  })

  assert.deepEqual(result, { ok: true, handledBy: 'real_tool' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'real_tool')
  assert.equal(calls[0].requestedName, 'alias_tool')
  assert.deepEqual(calls[0].args, { sample: true })
})

test('callTool enforces allow-list before tool runtime dispatch', async () => {
  let called = 0
  const toolRuntime = createToolRuntime({
    providers: [
      {
        blocked_tool: async () => {
          called += 1
          return { ok: true }
        },
      },
    ],
  })

  const adapter = buildAdapter({
    tools: {
      allow: new Set(['safe_tool']),
      aliases: { alias_tool: 'blocked_tool' },
    },
    agents: { profiles: {} },
    operators: { map: {} },
  }, { toolRuntime })

  await assert.rejects(
    () => adapter.callTool({ name: 'alias_tool' }),
    (err) => {
      assert.match(err.message, /Tool "alias_tool" is not allowed by workspace tools policy\./)
      return true
    },
  )
  assert.equal(called, 0)
})

test('callAgent supports direct model calls without profile lookup', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: {} },
      operators: { map: {} },
    },
    callAgent: async ({ model, messages }) => {
      calls.push({ model, messages })
      return 'pong'
    },
    defaultModel: 'default-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const response = await adapter.callAgent({
    model: 'phi3:mini-128k',
    prompt: 'ping',
  })

  assert.deepEqual(response, { value: 'pong', metadata: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'phi3:mini-128k')
  assert.equal(calls[0].messages.length, 1)
  assert.equal(calls[0].messages[0].role, 'user')
  assert.equal(calls[0].messages[0].content, 'ping')
})

test('callAgent resolves direct model aliases through models.map and transports.map', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: {} },
      models: {
        map: {
          'gemini-model': { model: 'gemini-2.5-flash-lite', transport: 'gemini' },
        },
      },
      transports: {
        map: {
          gemini: {
            provider: 'openai_compat',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
            apiKey: 'test-key',
          },
        },
      },
      operators: { map: {} },
    },
    callAgent: async ({ model, messages, transport }) => {
      calls.push({ model, messages, transport })
      return 'pong'
    },
    defaultModel: 'default-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const response = await adapter.callAgent({
    model: 'gemini-model',
    prompt: 'ping',
  })

  assert.deepEqual(response, { value: 'pong', metadata: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'gemini-2.5-flash-lite')
  assert.equal(calls[0].messages.length, 1)
  assert.equal(calls[0].messages[0].role, 'user')
  assert.equal(calls[0].messages[0].content, 'ping')
  assert.deepEqual(calls[0].transport, {
    provider: 'openai_compat',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'test-key',
  })
})

test('callAgent includes images when event payload provides images', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: {
        profiles: {
          visual: { model: 'qwen2.5vl' },
        },
      },
      operators: { map: {} },
    },
    callAgent: async ({ model, messages }) => {
      calls.push({ model, messages })
      return 'ok'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const response = await adapter.callAgent({
    agent: 'visual',
    prompt: 'describe this image',
    event: {
      payload: {
        images: ['  b64a  ', '', 'b64b'],
      },
    },
  })

  assert.deepEqual(response, { value: 'ok', metadata: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'qwen2.5vl')
  assert.equal(calls[0].messages.length, 1)
  assert.equal(calls[0].messages[0].role, 'user')
  assert.equal(calls[0].messages[0].content, 'describe this image')
  assert.deepEqual(calls[0].messages[0].images, ['b64a', 'b64b'])
})

test('callAgent omits images when event payload does not provide images', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: {
        profiles: {
          visual: { model: 'qwen2.5vl' },
        },
      },
      operators: { map: {} },
    },
    callAgent: async ({ messages }) => {
      calls.push(messages)
      return 'ok'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({
    agent: 'visual',
    prompt: 'describe this image',
    event: {
      payload: {},
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 1)
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0][0], 'images'), false)
})

test('callAgent includes images when relayed event stores them in value', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: {
      absolutePath: '/workspace',
      relativePath: '.',
    },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: {
        profiles: {
          visual: { model: 'qwen2.5vl' },
        },
      },
      operators: { map: {} },
    },
    callAgent: async ({ messages }) => {
      calls.push(messages)
      return 'ok'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({
      absolutePath: `${baseDir}/${pathRaw}`,
      relativePath: pathRaw,
    }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({
    agent: 'visual',
    prompt: 'describe this image',
    event: {
      value: {
        images: ['  b64a  ', '', 'b64b'],
      },
    },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0][0].images, ['b64a', 'b64b'])
})

test('callAgent forwards per-message images to Ollama transport', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { visual: { model: 'qwen2.5vl' } } },
      operators: { map: {} },
    },
    callAgent: async ({ model, messages }) => {
      calls.push({ model, messages })
      return 'ok'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({
    agent: 'visual',
    messages: [
      { role: 'user', content: 'what is this?', images: ['img1', 'img2'] },
      { role: 'assistant', content: 'a cat' },
    ],
    event: {},
  })

  assert.equal(calls.length, 1)
  const sentMessages = calls[0].messages
  assert.equal(sentMessages.length, 2)
  assert.deepEqual(sentMessages[0].images, ['img1', 'img2'])
  assert.equal(Object.hasOwn(sentMessages[1], 'images'), false)
})

test('callAgent omits images field on messages that have no images', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async ({ messages }) => {
      calls.push(messages)
      return 'ok'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({
    agent: 'chat',
    messages: [
      { role: 'user', content: 'hello' },
    ],
    event: {},
  })

  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0][0], 'images'), false)
})

test('callAgent appends return contract guidance to instruction layer', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3', instructions: 'profile rules' } } },
      operators: { map: {} },
    },
    callAgent: async ({ messages }) => {
      calls.push(messages)
      return '{"intent":"search"}'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value, format) => (format === 'json' ? JSON.parse(value) : value),
    validateAgentReturnContract: (output) => output,
    buildAgentReturnContractGuidance: () => 'Return only valid JSON matching this structure:\n{\n  "intent": ""\n}',
  })

  await adapter.callAgent({
    agent: 'chat',
    prompt: 'route this',
    instructions: 'call rules',
    returns: { intent: '' },
    validate: 'coerce',
    event: {},
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0].role, 'system')
  assert.match(calls[0][0].content, /profile rules/)
  assert.match(calls[0][0].content, /call rules/)
  assert.match(calls[0][0].content, /Return only valid JSON matching this structure/)
})

test('callAgent validates returns contract in strict mode', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => '{"intent":"search"}',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value, format) => (format === 'json' ? JSON.parse(value) : value),
    validateAgentReturnContract: (output, contract, mode) => {
      assert.equal(mode, 'strict')
      assert.deepEqual(contract, { intent: '', confidence: 0 })
      if (typeof output.confidence !== 'number') {
        const err = new Error('violation')
        err.code = 'AGENT_RETURN_CONTRACT_VIOLATION'
        err.path = 'confidence'
        err.expected = 'number'
        err.actual = 'undefined'
        throw err
      }
      return output
    },
  })

  await assert.rejects(
    () => adapter.callAgent({
      agent: 'chat',
      prompt: 'route this',
      returns: { intent: '', confidence: 0 },
      validate: 'strict',
      event: {},
    }),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'confidence')
      return true
    },
  )
})

test('callAgent validates returns contract in coerce mode', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => '{"intent":"search"}',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value, format) => (format === 'json' ? JSON.parse(value) : value),
    validateAgentReturnContract: (output, _contract, mode) => {
      assert.equal(mode, 'coerce')
      return { intent: output.intent, confidence: 0 }
    },
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'route this',
    returns: { intent: '', confidence: 0 },
    validate: 'coerce',
    event: {},
  })

  assert.deepEqual(result, {
    value: { intent: 'search', confidence: 0 },
    metadata: null,
  })
})

test('callAgent retries on JSON parse failure when retry_on_contract_violation is set', async () => {
  let callCount = 0
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => {
      callCount += 1
      // First call returns invalid JSON, second returns valid
      if (callCount === 1) return 'not valid json at all'
      return '{"intent":"search"}'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value, format) => {
      if (format === 'json') {
        const trimmed = value.trim()
        if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) throw new Error('JSON_PARSE_ERROR: not JSON')
        return JSON.parse(trimmed)
      }
      return value
    },
    validateAgentReturnContract: (output) => output,
    buildAgentRetryPrompt: () => 'Please respond with valid JSON.',
    captureAgentRequestPayload: true,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'route this',
    returns: { intent: '' },
    retry_on_contract_violation: 1,
    event: {},
  })

  assert.equal(callCount, 2)
  assert.deepEqual(result.value, { intent: 'search' })
  assert.equal(Array.isArray(result.metadata?.retryLineage?.attempts), true)
  assert.equal(result.metadata.retryLineage.attempts.length, 2)
  assert.equal(result.metadata.retryLineage.attempts[0].status, 'violation')
  assert.equal(result.metadata.retryLineage.attempts[1].status, 'success')
})

test('callAgent throws JSON parse error when retries exhausted', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => 'not valid json',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value, format) => {
      if (format === 'json') throw new Error('JSON_PARSE_ERROR: invalid json')
      return value
    },
    validateAgentReturnContract: (output) => output,
    captureAgentRequestPayload: true,
  })

  await assert.rejects(
    () => adapter.callAgent({
      agent: 'chat',
      prompt: 'route this',
      returns: { intent: '' },
      retry_on_contract_violation: 1,
      event: {},
    }),
    (err) => {
      assert.match(String(err?.message ?? ''), /JSON_PARSE_ERROR/)
      assert.equal(Array.isArray(err?.retryLineage?.attempts), true)
      assert.equal(err.retryLineage.attempts.length, 2)
      assert.equal(err.retryLineage.attempts[0].status, 'violation')
      assert.equal(err.retryLineage.attempts[1].status, 'violation')
      return true
    },
  )
})

test('callAgent emits slow-call warning metadata when transport exceeds threshold', async () => {
  const warnings = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { text: 'ok', metadata: { provider: 'test' } }
    },
    defaultModel: 'test-model',
    slowAgentWarningMs: 5,
    onSlowAgentCallWarning: (payload) => warnings.push(payload),
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'route this',
    event: { type: 'user_message', source: 'external' },
    line: 12,
    statement: 'route = agent("chat", event.value)',
    sourcePath: 'intent.nrv',
    sourceLine: 12,
  })

  assert.equal(warnings.length, 1)
  assert.equal(warnings[0].agent, 'chat')
  assert.equal(warnings[0].model, 'llama3')
  assert.equal(warnings[0].thresholdMs, 5)
  assert.equal(result.metadata.provider, 'test')
  assert.equal(result.metadata.slowWarningEmitted, true)
  assert.equal(typeof result.metadata.elapsedMs, 'number')
  assert.equal(result.metadata.elapsedMs >= 20, true)
})

test('callAgent includes request payload metadata when captureAgentRequestPayload is enabled', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3', instructions: 'profile instructions' } } },
      operators: { map: {} },
    },
    callAgent: async () => ({ text: 'ok', metadata: { provider: 'test' } }),
    defaultModel: 'test-model',
    captureAgentRequestPayload: true,
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'play Nirvana',
    instructions: 'call instructions',
    event: { type: 'user_message', source: 'external' },
  })

  assert.equal(result.value, 'ok')
  assert.equal(result.metadata.provider, 'test')
  assert.equal(result.metadata.request.targetKind, 'agent')
  assert.equal(result.metadata.request.target, 'chat')
  assert.equal(result.metadata.request.model, 'llama3')
  assert.equal(result.metadata.request.resolvedModel, 'llama3')
  assert.equal(result.metadata.request.resolvedModelAlias, 'llama3')
  assert.equal(result.metadata.request.messageCount, 2)
  assert.equal(result.metadata.request.instructions, 'profile instructions\n\ncall instructions')
  assert.equal(result.metadata.request.prompt, 'play Nirvana')
  assert.deepEqual(result.metadata.request.toolNames, [])
  assert.equal(Array.isArray(result.metadata.request.messages), true)
  assert.equal(result.metadata.request.messages[0].role, 'system')
  assert.match(result.metadata.request.messages[0].content, /profile instructions/)
  assert.equal(result.metadata.request.messages[1].role, 'user')
  assert.equal(result.metadata.request.messages[1].content, 'play Nirvana')
})

// --- Phase 3: Resolution pipeline (agents.profiles → models.map → transports.map) ---

test('callAgent resolves transport config from transports.map and passes it to callAgent', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'fast-llm' } } },
      models: { map: { 'fast-llm': { model: 'llama3.2', transport: 'ollama' } } },
      transports: { map: { ollama: { provider: 'ollama', base_url: 'http://localhost:11434' } } },
      operators: { map: {} },
    },
    callAgent: async (payload) => {
      calls.push(payload)
      return 'ok'
    },
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({ agent: 'chat', prompt: 'hello', event: {} })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'llama3.2')
  assert.deepEqual(calls[0].transport, { provider: 'ollama', base_url: 'http://localhost:11434' })
})

test('callAgent omits transport field when no transports.map entry exists', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { chat: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async (payload) => {
      calls.push(payload)
      return 'ok'
    },
    defaultModel: 'fallback-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({ agent: 'chat', prompt: 'hello', event: {} })

  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0], 'transport'), false)
})

test('callAgent resolves same agent config from session cache on repeated calls', async () => {
  let resolutions = 0
  const profiles = new Proxy(
    { chat: { model: 'llama3' } },
    {
      get(target, prop) {
        if (prop === 'chat') resolutions += 1
        return target[prop]
      },
    },
  )
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles },
      operators: { map: {} },
    },
    callAgent: async (payload) => { calls.push(payload); return 'ok' },
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await adapter.callAgent({ agent: 'chat', prompt: 'first', event: {} })
  await adapter.callAgent({ agent: 'chat', prompt: 'second', event: {} })

  assert.equal(calls.length, 2)
  // Profile should only be accessed once due to session cache
  assert.equal(resolutions, 1)
})

test('callAgent throws descriptive error when agent missing model ref', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { bare: {} } },
      operators: { map: {} },
    },
    callAgent: async () => 'ok',
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await assert.rejects(
    () => adapter.callAgent({ agent: 'bare', prompt: 'hi', event: {} }),
    /missing model.*agents\.json.*defaultModel/,
  )
})

// --- Phase 4: Capability metadata hook ---

test('getAgentCapabilities returns callAgent.capabilities when set on transport function', () => {
  const fakeCallAgent = async () => 'ok'
  fakeCallAgent.capabilities = { routingMode: 'forced', local: { id: 'llama.cpp' } }

  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: {} },
      transports: { map: { ollama: { provider: 'ollama', base_url: 'http://localhost:11434' } } },
      operators: { map: {} },
    },
    callAgent: fakeCallAgent,
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const caps = adapter.getAgentCapabilities()
  assert.deepEqual(caps, { routingMode: 'forced', local: { id: 'llama.cpp' } })
})

test('getAgentCapabilities falls back to config-declared transports map when callAgent has no capabilities', () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: {} },
      transports: {
        map: {
          ollama: { provider: 'ollama', base_url: 'http://localhost:11434', vision: true },
        },
      },
      operators: { map: {} },
    },
    callAgent: async () => 'ok',
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const caps = adapter.getAgentCapabilities()
  assert.equal(caps.source, 'config')
  assert.deepEqual(caps.transports.ollama, { provider: 'ollama', base_url: 'http://localhost:11434', vision: true })
})

test('getAgentCapabilities returns null when no runtime capabilities and no transports configured', () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: {} },
      operators: { map: {} },
    },
    callAgent: async () => 'ok',
    defaultModel: '',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  assert.equal(adapter.getAgentCapabilities(), null)
})

test('callAgent executes governed tool calls and feeds tool results back to model transport', async () => {
  const transportCalls = []
  const toolCalls = []

  const toolRuntime = createToolRuntime({
    providers: [
      {
        search: async ({ args }) => {
          toolCalls.push(args)
          return { hits: ['doc-1'], q: String(args?.q ?? '') }
        },
      },
    ],
  })

  let callCount = 0
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: new Set(['search']), aliases: {} },
      agents: { profiles: { chat: { model: 'gpt-4o', tools: ['search'] } } },
      operators: { map: {} },
    },
    callAgent: async (payload) => {
      transportCalls.push(payload)
      callCount += 1
      if (callCount === 1) {
        return {
          text: '',
          metadata: {
            provider: 'openai_compat',
            toolCalls: [{ id: 'call-1', name: 'search', argumentsRaw: '{"q":"nerveflow"}' }],
          },
        }
      }
      return { text: 'final answer', metadata: { provider: 'openai_compat' } }
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    toolRuntime,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'find docs',
    tools: { mode: 'governed', maxRounds: 4, allow: ['search'] },
    event: { type: 'user_message', source: 'external' },
    state: {},
    locals: {},
    line: 12,
    statement: 'answer = agent("chat", event.value)',
  })

  assert.equal(result.value, 'final answer')
  assert.equal(callCount, 2)
  assert.equal(toolCalls.length, 1)
  assert.equal(toolCalls[0].q, 'nerveflow')
  assert.equal(Array.isArray(transportCalls[0].tools), true)
  assert.equal(transportCalls[0].tools.length, 1)
  assert.equal(transportCalls[0].tools[0].function.name, 'search')
  assert.equal(transportCalls[1].messages.some((m) => m.role === 'tool' && /doc-1/.test(String(m.content))), true)
  assert.equal(result.metadata.tools.mode, 'governed')
  assert.equal(result.metadata.tools.timeoutMs, 0)
  assert.equal(result.metadata.tools.denyOnUnknownTool, true)
  assert.equal(result.metadata.tools.toolCalls, 1)
  assert.equal(result.metadata.tools.deniedToolCalls, 0)
  assert.deepEqual(result.metadata.tools.toolsUsed, ['search'])
})

test('callAgent does not execute tool calls when tools mode is disabled', async () => {
  let toolRuntimeCalled = false
  const toolRuntime = createToolRuntime({
    providers: [
      {
        search: async () => {
          toolRuntimeCalled = true
          return { ok: true }
        },
      },
    ],
  })

  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: new Set(['search']), aliases: {} },
      agents: { profiles: { chat: { model: 'gpt-4o', tools: ['search'] } } },
      operators: { map: {} },
    },
    callAgent: async () => ({
      text: 'direct answer',
      metadata: {
        provider: 'openai_compat',
        toolCalls: [{ id: 'call-1', name: 'search', argumentsRaw: '{"q":"ignored"}' }],
      },
    }),
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    toolRuntime,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'find docs',
    tools: { mode: 'disabled' },
    event: { type: 'user_message', source: 'external' },
  })

  assert.equal(result.value, 'direct answer')
  assert.equal(toolRuntimeCalled, false)
  assert.equal(result.metadata.provider, 'openai_compat')
  assert.equal(Object.prototype.hasOwnProperty.call(result.metadata, 'tools'), false)
})

test('callAgent governed mode denies unknown tools by default', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: new Set(['search']), aliases: {} },
      agents: { profiles: { chat: { model: 'gpt-4o', tools: ['search'] } } },
      operators: { map: {} },
    },
    callAgent: async () => ({
      text: '',
      metadata: {
        provider: 'openai_compat',
        toolCalls: [{ id: 'call-1', name: 'fetch', argumentsRaw: '{"url":"https://example.com"}' }],
      },
    }),
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  await assert.rejects(
    () => adapter.callAgent({
      agent: 'chat',
      prompt: 'find docs',
      tools: { mode: 'governed', maxRounds: 2, allow: ['search'] },
      event: { type: 'user_message', source: 'external' },
    }),
    /not allowed by tools policy/,
  )
})

test('callAgent governed mode can continue when denyOnUnknownTool is false', async () => {
  let callCount = 0
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: new Set(['search']), aliases: {} },
      agents: { profiles: { chat: { model: 'gpt-4o', tools: ['search'] } } },
      operators: { map: {} },
    },
    callAgent: async () => {
      callCount += 1
      if (callCount === 1) {
        return {
          text: '',
          metadata: {
            provider: 'openai_compat',
            toolCalls: [{ id: 'call-1', name: 'fetch', argumentsRaw: '{"url":"https://example.com"}' }],
          },
        }
      }
      return { text: 'answer after deny', metadata: { provider: 'openai_compat' } }
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
  })

  const result = await adapter.callAgent({
    agent: 'chat',
    prompt: 'find docs',
    tools: { mode: 'governed', maxRounds: 3, allow: ['search'], denyOnUnknownTool: false },
    event: { type: 'user_message', source: 'external' },
  })

  assert.equal(result.value, 'answer after deny')
  assert.equal(result.metadata.tools.mode, 'governed')
  assert.equal(result.metadata.tools.denyOnUnknownTool, false)
  assert.equal(result.metadata.tools.deniedToolCalls, 1)
})

test('callAgent governed mode enforces timeoutMs', async () => {
  const toolRuntime = createToolRuntime({
    providers: [
      {
        search: async () => ({ ok: true }),
      },
    ],
  })

  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: new Set(['search']), aliases: {} },
      agents: { profiles: { chat: { model: 'gpt-4o', tools: ['search'] } } },
      operators: { map: {} },
    },
    callAgent: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        text: '',
        metadata: {
          provider: 'openai_compat',
          toolCalls: [{ id: 'call-1', name: 'search', argumentsRaw: '{"q":"slow"}' }],
        },
      }
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions: (prompt) => prompt,
    normalizeAgentFormattedOutput: (value) => value,
    toolRuntime,
  })

  await assert.rejects(
    () => adapter.callAgent({
      agent: 'chat',
      prompt: 'find docs',
      tools: { mode: 'governed', maxRounds: 3, allow: ['search'], timeoutMs: 1 },
      event: { type: 'user_message', source: 'external' },
      state: {},
      locals: {},
      line: 1,
      statement: 'answer = agent("chat", event.value)',
    }),
    /exceeded tools\.timeoutMs/,
  )
})
