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

export function mcpCapability({ servers = [] } = {}) {
  if (!Array.isArray(servers)) {
    throw new Error('mcpCapability servers must be an array')
  }

  const toolProviders = servers.map((serverConfig) => {
    return createMcpServerProvider(serverConfig)
  })

  return {
    toolProviders,
  }
}

/**
 * Internal: Creates a tool provider for a single MCP server.
 */
function createMcpServerProvider(serverConfig) {
  const { name, transport, config } = serverConfig

  if (!name || typeof name !== 'string') {
    throw new Error('MCP server config requires name property')
  }

  if (!transport || typeof transport !== 'string') {
    throw new Error(`MCP server ${name} requires transport property`)
  }

  if (!config || typeof config !== 'object') {
    throw new Error(`MCP server ${name} requires config property`)
  }

  // Create a tool provider object that lazily initializes the MCP client
  const toolProvider = {}
  let clientPromise = null

  async function getOrInitializeClient() {
    if (clientPromise) return clientPromise

    clientPromise = initializeClient(name, transport, config)
    return clientPromise
  }

  // Attach dynamic tool methods
  return new Proxy(toolProvider, {
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
          return callMcpTool(client, prop, args)
        }
      }

      return undefined
    },
  })
}

async function initializeClient(name, transport, config) {
  let transportInstance

  if (transport === 'stdio') {
    const { command, args = [], env } = config
    transportInstance = new StdioClientTransport({
      command,
      args,
      env,
    })
  } else {
    throw new Error(`Unsupported MCP transport: ${transport}`)
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

async function callMcpTool(client, toolName, args) {
  try {
    const tools = await client.listTools()
    const tool = tools.tools.find((t) => t.name === toolName)

    if (!tool) {
      return {
        ok: false,
        error: `Tool ${toolName} not found in MCP server`,
      }
    }

    // Convert args to tool input format
    const input = args.length > 0 && typeof args[0] === 'object' ? args[0] : {}

    const result = await client.callTool({
      name: toolName,
      arguments: input,
    })

    return {
      ok: true,
      content: result.content,
    }
  } catch (err) {
    return {
      ok: false,
      error: String(err?.message || err),
    }
  }
}
