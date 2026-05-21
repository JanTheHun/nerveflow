import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  mcpCapability,
} from '../src/host_core/index.js'
import { createToolRuntime } from '../src/host_core/tool_runtime.js'

async function createMockStdioMcpServer({
  serverName = 'mock-mcp',
  toolName = 'echo_message',
  responsePrefix = 'echo',
} = {}) {
  const tempDir = await mkdtemp(path.join(process.cwd(), '.tmp-mcp-capability-test-'))
  const scriptPath = path.join(tempDir, `${serverName}.mjs`)
  const source = [
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
    '',
    `const server = new McpServer({ name: '${serverName}', version: '1.0.0' })`,
    '',
    `server.registerTool('${toolName}', {`,
    "  description: 'Test helper tool',",
    '}, async (args = {}) => {',
    "  const text = String(args.text ?? '')",
    '  return {',
    '    content: [',
    `      { type: 'text', text: '${responsePrefix}:' + text },`,
    '    ],',
    '  }',
    '})',
    '',
    'const transport = new StdioServerTransport()',
    'await server.connect(transport)',
    '',
  ].join('\n')

  await writeFile(scriptPath, source, 'utf8')
  return {
    scriptPath,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  }
}

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

test('mcpCapability rejects non-boolean eagerConnect', () => {
  assert.throws(
    () => mcpCapability({ eagerConnect: 'yes' }),
    /eagerConnect must be a boolean/i,
  )
})

test('mcpCapability rejects non-boolean detectToolConflicts', () => {
  assert.throws(
    () => mcpCapability({ detectToolConflicts: 'yes' }),
    /detectToolConflicts must be a boolean/i,
  )
})

test('mcpCapability validates stdio command at call time', async () => {
  const capability = mcpCapability({
    servers: [{
      name: 'broken-stdio',
      transport: 'stdio',
      config: {},
    }],
  })

  await assert.rejects(
    () => capability.toolProviders[0].echo_message({ text: 'hi' }),
    /stdio transport requires config.command/i,
  )
})

test('mcpCapability validates sse url schema at call time', async () => {
  const capability = mcpCapability({
    servers: [{
      name: 'broken-sse',
      transport: 'sse',
      config: {
        url: 'ws://invalid.example',
      },
    }],
  })

  await assert.rejects(
    () => capability.toolProviders[0].echo_message({ text: 'hi' }),
    /sse transport config\.url must use http or https/i,
  )
})

test('mcpCapability validates websocket url schema at call time', async () => {
  const capability = mcpCapability({
    servers: [{
      name: 'broken-websocket',
      transport: 'websocket',
      config: {
        url: 'https://invalid.example',
      },
    }],
  })

  await assert.rejects(
    () => capability.toolProviders[0].echo_message({ text: 'hi' }),
    /websocket transport config\.url must use ws or wss/i,
  )
})

test('mcpCapability supports stdio tool round-trip', async () => {
  const server = await createMockStdioMcpServer({
    serverName: 'stdio-roundtrip',
    toolName: 'echo_message',
    responsePrefix: 'roundtrip',
  })

  const capability = mcpCapability({
    servers: [{
      name: 'roundtrip-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [server.scriptPath],
      },
    }],
    eagerConnect: true,
    detectToolConflicts: true,
  })

  try {
    if (typeof capability.setup === 'function') {
      await capability.setup()
    }

    const result = await capability.toolProviders[0].echo_message()
    assert.equal(result.ok, true)
    assert.equal(Array.isArray(result.content), true)
    assert.equal(JSON.stringify(result.content).includes('roundtrip:'), true)
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await server.cleanup()
  }
})

test('mcpCapability parses JSON string arguments for MCP tool calls', async () => {
  const server = await createMockStdioMcpServer({
    serverName: 'json-args-roundtrip',
    toolName: 'echo_message',
    responsePrefix: 'json',
  })

  const capability = mcpCapability({
    servers: [{
      name: 'json-args-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [server.scriptPath],
      },
    }],
  })

  try {
    const result = await capability.toolProviders[0].echo_message('{"text":"hello"}')
    assert.equal(result.ok, true)
    assert.equal(JSON.stringify(result.content).includes('json:'), true)
    assert.equal(result.metadata?.argShape, 'json_string_object')
    assert.equal(result.metadata?.serverName, 'json-args-server')
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await server.cleanup()
  }
})

test('mcpCapability returns structured error metadata when tool is missing', async () => {
  const server = await createMockStdioMcpServer({
    serverName: 'missing-tool-roundtrip',
    toolName: 'echo_message',
    responsePrefix: 'missing',
  })

  const capability = mcpCapability({
    servers: [{
      name: 'missing-tool-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [server.scriptPath],
      },
    }],
  })

  try {
    const result = await capability.toolProviders[0].not_real_tool({ text: 'hi' })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'unavailable')
    assert.equal(result.toolName, 'not_real_tool')
    assert.equal(result.serverName, 'missing-tool-server')
    assert.equal(result.details?.reason, 'tool_not_found')
    assert.match(result.error, /not found/i)
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await server.cleanup()
  }
})

test('mcpCapability surfaces MCP isError content text in tool error message', async () => {
  const tempDir = await mkdtemp(path.join(process.cwd(), '.tmp-mcp-error-content-test-'))
  const scriptPath = path.join(tempDir, 'error-content-server.mjs')
  const source = [
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
    '',
    "const server = new McpServer({ name: 'error-content-server', version: '1.0.0' })",
    '',
    "server.registerTool('list_directory', {",
    "  description: 'Returns an MCP isError payload with text content',",
    '}, async () => ({',
    '  isError: true,',
    '  content: [',
    '    { type: "text", text: "Access denied for test path" },',
    '  ],',
    '}))',
    '',
    'const transport = new StdioServerTransport()',
    'await server.connect(transport)',
    '',
  ].join('\n')

  await writeFile(scriptPath, source, 'utf8')

  const capability = mcpCapability({
    servers: [{
      name: 'error-content-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [scriptPath],
      },
    }],
  })

  try {
    const result = await capability.toolProviders[0].list_directory({ path: '/tmp' })
    assert.equal(result.ok, false)
    assert.equal(result.errorCode, 'tool_error')
    assert.match(String(result.message ?? ''), /Access denied for test path/)
    assert.equal(result.details?.isError, true)
    assert.match(String(result.details?.mcpContentText ?? ''), /Access denied for test path/)
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('mcpCapability exposes tool metadata for discovered tools', async () => {
  const server = await createMockStdioMcpServer({
    serverName: 'metadata-roundtrip',
    toolName: 'echo_message',
    responsePrefix: 'metadata',
  })

  const capability = mcpCapability({
    servers: [{
      name: 'metadata-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [server.scriptPath],
      },
    }],
  })

  try {
    const metadata = await capability.getToolMetadata('echo_message')
    assert.equal(metadata?.name, 'echo_message')
    assert.equal(metadata?.serverName, 'metadata-server')
    assert.equal(typeof metadata?.description, 'string')
    if (metadata?.inputSchema != null) {
      assert.equal(typeof metadata.inputSchema, 'object')
      assert.equal(Array.isArray(metadata.inputSchema), false)
    }
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await server.cleanup()
  }
})

test('mcpCapability preserves inputSchema from MCP server in tool metadata', async () => {
  const tempDir = await mkdtemp(path.join(process.cwd(), '.tmp-mcp-schema-test-'))
  const scriptPath = path.join(tempDir, 'schema-server.mjs')
  const source = [
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
    "import { z } from 'zod'",
    '',
    "const server = new McpServer({ name: 'schema-server', version: '1.0.0' })",
    '',
    "server.registerTool('read_file', {",
    "  description: 'Read the contents of a file',",
    '  inputSchema: { path: z.string().describe("Absolute path to the file") },',
    '}, async (args = {}) => {',
    '  return { content: [{ type: "text", text: "ok" }] }',
    '})',
    '',
    'const transport = new StdioServerTransport()',
    'await server.connect(transport)',
    '',
  ].join('\n')
  await import('node:fs/promises').then(({ writeFile }) => writeFile(scriptPath, source, 'utf8'))

  const capability = mcpCapability({
    servers: [{
      name: 'schema-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [scriptPath],
      },
    }],
  })

  try {
    const metadata = await capability.getToolMetadata('read_file')
    assert.equal(metadata?.name, 'read_file')
    assert.equal(metadata?.description, 'Read the contents of a file')
    assert.ok(metadata?.inputSchema != null, 'inputSchema should be present')
    assert.equal(typeof metadata.inputSchema, 'object')
    assert.equal(Array.isArray(metadata.inputSchema), false)
    // MCP SDK converts Zod schema to JSON Schema — properties should include 'path'
    const props = metadata.inputSchema?.properties
    assert.ok(props != null, 'inputSchema.properties should be present')
    assert.ok('path' in props, 'inputSchema.properties should include path')
    assert.equal(props.path?.type, 'string')
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('mcpCapability toolRuntime forwards named args to schema-backed tools', async () => {
  const tempDir = await mkdtemp(path.join(process.cwd(), '.tmp-mcp-runtime-schema-call-test-'))
  const scriptPath = path.join(tempDir, 'runtime-schema-call-server.mjs')
  const source = [
    "import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'",
    "import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'",
    "import { z } from 'zod'",
    '',
    "const server = new McpServer({ name: 'runtime-schema-call-server', version: '1.0.0' })",
    '',
    "server.registerTool('read_file', {",
    "  description: 'Echoes path when provided',",
    '  inputSchema: { path: z.string().describe("Absolute path to the file") },',
    '}, async (args = {}) => ({',
    '  content: [{ type: "text", text: String(args.path ?? "") }],',
    '}))',
    '',
    'const transport = new StdioServerTransport()',
    'await server.connect(transport)',
    '',
  ].join('\n')

  await import('node:fs/promises').then(({ writeFile }) => writeFile(scriptPath, source, 'utf8'))

  const capability = mcpCapability({
    servers: [{
      name: 'runtime-schema-call-server',
      transport: 'stdio',
      config: {
        command: process.execPath,
        args: [scriptPath],
      },
    }],
  })
  const toolRuntime = createToolRuntime({ providers: capability.toolProviders })

  try {
    const result = await toolRuntime.call({ name: 'read_file', args: { path: 'AGENTS.md' } })
    assert.equal(result?.ok, true)
    assert.equal(result?.metadata?.argShape, 'runtime_payload_named_args')
    assert.equal(JSON.stringify(result?.content ?? '').includes('AGENTS.md'), true)
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await rm(tempDir, { recursive: true, force: true })
  }
})

test('mcpCapability setup rejects duplicate tool names across servers', async () => {
  const serverA = await createMockStdioMcpServer({
    serverName: 'dup-a',
    toolName: 'duplicate_tool',
    responsePrefix: 'a',
  })
  const serverB = await createMockStdioMcpServer({
    serverName: 'dup-b',
    toolName: 'duplicate_tool',
    responsePrefix: 'b',
  })

  const capability = mcpCapability({
    servers: [
      {
        name: 'dup-a',
        transport: 'stdio',
        config: {
          command: process.execPath,
          args: [serverA.scriptPath],
        },
      },
      {
        name: 'dup-b',
        transport: 'stdio',
        config: {
          command: process.execPath,
          args: [serverB.scriptPath],
        },
      },
    ],
    detectToolConflicts: true,
  })

  try {
    await assert.rejects(
      () => capability.setup(),
      /Duplicate MCP tool name "duplicate_tool"/i,
    )
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await serverA.cleanup()
    await serverB.cleanup()
  }
})

test('mcpCapability multi-server falls through unavailable tool to next server', async () => {
  const serverA = await createMockStdioMcpServer({
    serverName: 'fallthrough-a',
    toolName: 'tool_from_a_only',
    responsePrefix: 'a',
  })
  const serverB = await createMockStdioMcpServer({
    serverName: 'fallthrough-b',
    toolName: 'tool_from_b_only',
    responsePrefix: 'b',
  })

  const capability = mcpCapability({
    servers: [
      {
        name: 'server-a',
        transport: 'stdio',
        config: {
          command: process.execPath,
          args: [serverA.scriptPath],
        },
      },
      {
        name: 'server-b',
        transport: 'stdio',
        config: {
          command: process.execPath,
          args: [serverB.scriptPath],
        },
      },
    ],
  })

  const toolRuntime = createToolRuntime({ providers: capability.toolProviders })

  try {
    const fromA = await toolRuntime.call({ name: 'tool_from_a_only', args: { text: 'one' } })
    assert.equal(fromA?.ok, true)
    assert.equal(fromA?.metadata?.serverName, 'server-a')
    assert.equal(fromA?.metadata?.argShape, 'runtime_payload_named_args')
    assert.equal(JSON.stringify(fromA?.content ?? '').includes('a:'), true)

    const fromB = await toolRuntime.call({ name: 'tool_from_b_only', args: { text: 'two' } })
    assert.equal(fromB?.ok, true)
    assert.equal(fromB?.metadata?.serverName, 'server-b')
    assert.equal(fromB?.metadata?.argShape, 'runtime_payload_named_args')
    assert.equal(JSON.stringify(fromB?.content ?? '').includes('b:'), true)

    await assert.rejects(
      () => toolRuntime.call({ name: 'tool_from_nowhere' }),
      /Tool "tool_from_nowhere" is not available in this host yet\./,
    )
  } finally {
    if (typeof capability.teardown === 'function') {
      await capability.teardown()
    }
    await serverA.cleanup()
    await serverB.cleanup()
  }
})
