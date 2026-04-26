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

  assert.equal(response, 'ok')
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

  assert.deepEqual(result, { intent: 'search', confidence: 0 })
})
