import test from 'node:test'
import assert from 'node:assert/strict'
import { createHostAdapter } from '../src/host_core/runtime_session.js'

function buildAdapter(workspaceConfig) {
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
