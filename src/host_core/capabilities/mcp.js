/**
 * mcpCapability creates an MCP (Model Context Protocol) capability that provides
 * tool-based access to external MCP servers (e.g., database tools, web search, file systems).
 *
 * Configuration:
 *   servers: Array of server configurations, each with:
 *     - name: Server identifier (required, e.g. 'database', 'weather')
 *     - transport: Transport type ('stdio', 'sse', or 'websocket') (required)
 *     - config: Transport-specific configuration (required)
 *       For 'stdio': { command, args?, env? }
 *       For 'sse': { url, apiKey?, headers? }
 *       For 'websocket': { url }
 *
 * Usage:
 *   host.attachCapability(mcpCapability({
 *     servers: [
 *       {
 *         name: 'database',
 *         transport: 'stdio',
 *         config: { command: 'python', args: ['mcp-server-database.py'] }
 *       }
 *     ]
 *   }))
 *
 * The capability returns a toolProvider for each server's tools.
 */

import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'

export function mcpCapability({
  servers = [],
  eagerConnect = false,
  detectToolConflicts = false,
} = {}) {
  if (!Array.isArray(servers)) {
    throw new Error('mcpCapability servers must be an array')
  }

  if (typeof eagerConnect !== 'boolean') {
    throw new Error('mcpCapability eagerConnect must be a boolean')
  }

  if (typeof detectToolConflicts !== 'boolean') {
    throw new Error('mcpCapability detectToolConflicts must be a boolean')
  }

  const providers = servers.map((serverConfig) => {
    return createMcpServerProvider(serverConfig)
  })
  const toolProviders = providers.map((entry) => entry.toolProvider)

  const shouldRunSetup = eagerConnect || detectToolConflicts

  const capability = {
    toolProviders,
    toolMetadataProviders: providers.map((entry) => entry.getToolMetadata),
    getToolMetadata: async (toolName) => {
      const requestedName = String(toolName ?? '').trim()
      if (!requestedName) return null

      for (const provider of providers) {
        const metadata = await provider.getToolMetadata(requestedName)
        if (metadata && typeof metadata === 'object') {
          return metadata
        }
      }

      return null
    },
  }

  if (shouldRunSetup) {
    capability.setup = async () => {
      const seenTools = new Map()

      for (const provider of providers) {
        const client = await provider.getOrInitializeClient()

        if (!detectToolConflicts) {
          continue
        }

        const toolsResponse = await client.listTools()
        const tools = Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : []

        for (const tool of tools) {
          const toolName = String(tool?.name ?? '').trim()
          if (!toolName) continue

          if (seenTools.has(toolName)) {
            const previousServerName = seenTools.get(toolName)
            throw new Error(`Duplicate MCP tool name "${toolName}" detected across servers "${previousServerName}" and "${provider.serverName}"`)
          }
          seenTools.set(toolName, provider.serverName)
        }
      }
    }
  }

  capability.teardown = async () => {
    for (const provider of providers) {
      await provider.closeClient()
    }
  }

  return capability
}

/**
 * Internal: Creates a tool provider for a single MCP server.
 */
function createMcpServerProvider(serverConfig) {
  const {
    name,
    transport,
    config,
  } = normalizeMcpServerConfig(serverConfig)

  // Create a tool provider object that lazily initializes the MCP client
  const toolProvider = {}
  let clientPromise = null
  let listToolsPromise = null

  async function getOrInitializeClient() {
    if (clientPromise) return clientPromise

    clientPromise = initializeClient(name, transport, config)
    return clientPromise
  }

  async function listTools() {
    if (listToolsPromise) {
      return listToolsPromise
    }

    listToolsPromise = (async () => {
      const client = await getOrInitializeClient()
      const toolsResponse = await client.listTools()
      return Array.isArray(toolsResponse?.tools) ? toolsResponse.tools : []
    })()

    try {
      return await listToolsPromise
    } catch (err) {
      listToolsPromise = null
      throw err
    }
  }

  async function getToolMetadata(toolNameRaw) {
    const toolName = String(toolNameRaw ?? '').trim()
    if (!toolName) return null

    try {
      const tools = await listTools()
      const tool = tools.find((entry) => String(entry?.name ?? '').trim() === toolName)
      if (!tool) return null

      return {
        name: toolName,
        description: String(tool?.description ?? '').trim(),
        inputSchema: normalizeMcpInputSchema(tool?.inputSchema),
        serverName: name,
      }
    } catch {
      return null
    }
  }

  async function closeClient() {
    if (!clientPromise) return

    try {
      const client = await clientPromise
      if (client && typeof client.close === 'function') {
        await client.close()
      }
    } catch {
      // No-op: closing a failed or partially initialized client should not fail teardown.
    } finally {
      clientPromise = null
      listToolsPromise = null
    }
  }

  // Attach dynamic tool methods
  return {
    serverName: name,
    getOrInitializeClient,
    closeClient,
    getToolMetadata,
    toolProvider: new Proxy(toolProvider, {
    get(target, prop, receiver) {
      // Return the actual value if it exists
      if (prop in target) {
        return Reflect.get(target, prop, receiver)
      }

      // For any other property, assume it's a tool name
      if (typeof prop === 'string' && prop !== 'toJSON' && !prop.startsWith('_')) {
        // Return an async function that calls the tool on the MCP client
        return async (...args) => {
          const client = await getOrInitializeClient()
          return callMcpTool(client, name, prop, args, listTools)
        }
      }

      return undefined
    },
    }),
  }
}

function normalizeMcpServerConfig(serverConfigRaw) {
  if (!serverConfigRaw || typeof serverConfigRaw !== 'object' || Array.isArray(serverConfigRaw)) {
    throw new Error('MCP server config requires an object')
  }

  const name = String(serverConfigRaw.name ?? '').trim()
  if (!name) {
    throw new Error('MCP server config requires name property')
  }

  const transport = String(serverConfigRaw.transport ?? '').trim()
  if (!transport) {
    throw new Error(`MCP server ${name} requires transport property`)
  }

  const configRaw = serverConfigRaw.config
  if (!configRaw || typeof configRaw !== 'object' || Array.isArray(configRaw)) {
    throw new Error(`MCP server ${name} requires config property`)
  }

  return {
    name,
    transport,
    config: configRaw,
  }
}

function normalizeMcpInputSchema(inputSchemaRaw) {
  if (!inputSchemaRaw || typeof inputSchemaRaw !== 'object' || Array.isArray(inputSchemaRaw)) {
    return null
  }
  return inputSchemaRaw
}

async function initializeClient(name, transport, config) {
  const normalizedTransport = String(transport ?? '').trim().toLowerCase()
  let transportInstance

  if (normalizedTransport === 'stdio') {
    const { command, args = [], env } = config
    if (!command || typeof command !== 'string') {
      throw new Error(`MCP server ${name} stdio transport requires config.command`) 
    }
    transportInstance = new StdioClientTransport({
      command,
      args,
      env,
    })
  } else if (normalizedTransport === 'sse') {
    const { url, headers = {}, apiKey = '' } = config
    if (!url || typeof url !== 'string') {
      throw new Error(`MCP server ${name} sse transport requires config.url`) 
    }

    const resolvedUrl = new URL(url)
    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
      throw new Error(`MCP server ${name} sse transport config.url must use http or https`) 
    }

    if (headers != null && (typeof headers !== 'object' || Array.isArray(headers))) {
      throw new Error(`MCP server ${name} sse transport config.headers must be an object when provided`) 
    }

    const requestHeaders = {}
    for (const [key, value] of Object.entries(headers ?? {})) {
      if (!key) continue
      requestHeaders[key] = String(value)
    }

    if (apiKey && !Object.keys(requestHeaders).some((headerName) => headerName.toLowerCase() === 'authorization')) {
      requestHeaders.Authorization = `Bearer ${apiKey}`
    }

    transportInstance = new SSEClientTransport(resolvedUrl, {
      eventSourceInit: {
        headers: requestHeaders,
      },
      requestInit: {
        headers: requestHeaders,
      },
    })
  } else if (normalizedTransport === 'websocket') {
    const { url } = config
    if (!url || typeof url !== 'string') {
      throw new Error(`MCP server ${name} websocket transport requires config.url`) 
    }

    const resolvedUrl = new URL(url)
    if (resolvedUrl.protocol !== 'ws:' && resolvedUrl.protocol !== 'wss:') {
      throw new Error(`MCP server ${name} websocket transport config.url must use ws or wss`) 
    }

    transportInstance = new WebSocketClientTransport(resolvedUrl)
  } else {
    throw new Error(`Unsupported MCP transport: ${transport} (supported: stdio, sse, websocket)`)
  }

  const client = new MCPClient(
    {
      name: `nerveflow-mcp-${name}`,
      version: '1.0.0',
    },
    {
      capabilities: {},
    },
  )

  await client.connect(transportInstance)
  return client
}

function normalizeMcpToolInput(argsRaw = []) {
  if (!Array.isArray(argsRaw) || argsRaw.length === 0) {
    return {
      input: {},
      argShape: 'empty',
    }
  }

  const firstArg = argsRaw[0]

  // createToolRuntime providers receive a payload envelope
  // ({ name, args, positional, ... }). Unwrap named args for MCP calls.
  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)
    && (Object.prototype.hasOwnProperty.call(firstArg, 'args')
      || Object.prototype.hasOwnProperty.call(firstArg, 'positional'))) {
    const namedArgs = firstArg.args
    if (namedArgs && typeof namedArgs === 'object' && !Array.isArray(namedArgs)) {
      return {
        input: namedArgs,
        argShape: 'runtime_payload_named_args',
      }
    }

    const positionalArgs = Array.isArray(firstArg.positional) ? firstArg.positional : []
    if (positionalArgs.length > 0) {
      return normalizeMcpToolInput(positionalArgs)
    }

    return {
      input: {},
      argShape: 'runtime_payload_empty',
    }
  }

  if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    return {
      input: firstArg,
      argShape: argsRaw.length === 1 ? 'object' : 'object_with_extra_args',
    }
  }

  if (typeof firstArg === 'string') {
    const trimmed = firstArg.trim()
    if (!trimmed) {
      return {
        input: {},
        argShape: 'empty_string',
      }
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          input: parsed,
          argShape: 'json_string_object',
        }
      }
    } catch {
      // Fall back to best-effort wrapper below.
    }
  }

  if (argsRaw.length === 1) {
    return {
      input: { value: firstArg },
      argShape: 'single_primitive',
    }
  }

  return {
    input: { positional: argsRaw },
    argShape: 'positional_array',
  }
}

function classifyMcpToolError(err) {
  const message = String(err?.message || err || 'Unknown MCP tool error')
  const normalized = message.toLowerCase()

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'timeout'
  }

  if (normalized.includes('not found') || normalized.includes('unknown tool')) {
    return 'unavailable'
  }

  if (normalized.includes('connect') || normalized.includes('connection') || normalized.includes('econnrefused')) {
    return 'connection_error'
  }

  if (normalized.includes('schema') || normalized.includes('invalid argument') || normalized.includes('validation')) {
    return 'schema_violation'
  }

  return 'tool_error'
}

function extractMcpToolErrorContentText(result) {
  const content = result?.content
  if (!Array.isArray(content)) return ''

  const textParts = content
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return ''
      if (typeof entry.text === 'string') return entry.text.trim()
      return ''
    })
    .filter(Boolean)

  return textParts.join('\n').trim()
}

async function callMcpTool(client, serverName, toolName, args, listToolsFn = null) {
  try {
    const tools = typeof listToolsFn === 'function'
      ? await listToolsFn()
      : (await client.listTools())?.tools || []
    const tool = tools.find((t) => String(t?.name ?? '').trim() === toolName)

    if (!tool) {
      const errorMessage = `Tool ${toolName} not found in MCP server`
      return {
        ok: false,
        handled: false,
        error: errorMessage,
        errorCode: 'unavailable',
        message: errorMessage,
        serverName,
        toolName,
        details: {
          reason: 'tool_not_found',
        },
      }
    }

    const {
      input,
      argShape,
    } = normalizeMcpToolInput(args)

    const result = await client.callTool({
      name: toolName,
      arguments: input,
    })

    if (result?.isError) {
      const contentText = extractMcpToolErrorContentText(result)
      const toolMessage = String(result?.error ?? result?.message ?? contentText ?? 'MCP tool returned an error result').trim() || 'MCP tool returned an error result'
      return {
        ok: false,
        error: toolMessage,
        errorCode: 'tool_error',
        message: toolMessage,
        serverName,
        toolName,
        details: {
          argShape,
          isError: true,
          mcpContentText: contentText || undefined,
        },
      }
    }

    return {
      ok: true,
      content: result.content,
      metadata: {
        serverName,
        toolName,
        argShape,
      },
    }
  } catch (err) {
    const errorMessage = String(err?.message || err)
    const errorCode = classifyMcpToolError(err)
    return {
      ok: false,
      handled: errorCode === 'unavailable' ? false : true,
      error: errorMessage,
      errorCode,
      message: errorMessage,
      serverName,
      toolName,
    }
  }
}
