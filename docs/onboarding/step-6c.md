# Onboarding Step 6C

# Add MCP-powered assistants to your host

In previous onboarding steps, you built:

* deterministic workflows
* bounded routing
* host-provided tools

In this step, you attach external capabilities through MCP (Model Context Protocol).

The workflow stays deterministic.
The host exposes new capabilities through governed tool surfaces.

You will progressively build two assistants:

1. Workspace Guide — understands your local project
2. Research Analyst — combines local and external knowledge

---

# Why this matters

MCP does not change the workflow language.

Capabilities attach through the host layer.

Your workflow still decides:

* when tools are allowed
* which tools are allowed
* how many rounds are permitted
* when execution stops

The runtime enforces those boundaries deterministically.

---

# Prerequisites

- You completed the composable host setup steps.
- Your workspace has `nerve.json` (or `nextv.json`) and a workflow.
- Node.js is available in your shell.
- For tool-calling validation, prefer `qwen3:14b` as the assistant model.

Recommended setup:

```bash
ollama pull qwen3:14b
```

---

# 1. Scaffold MCP capability support

From repository root:

```bash
npx nerve-compose add mcp --json
```

Why no trailing workspace dot here:

- `nerve-compose add mcp` defaults to current working directory when `workspaceDir` is omitted.
- Adding `.` is optional from repo root and can be omitted for cleaner onboarding commands.

This adds:

* `requires.mcp`
* `modules.mcp`
* a local MCP server scaffold

Validate capability bindings:

```bash
npx nerve-compose validate --json
```

Expected:

```json
{
  "ok": true
}
```

---

# 2. Start the composable host

```bash
WORKSPACE_DIR=. PORT=4190 node examples/composable-reference-host/server.js
```

Runtime WS endpoint:

```text
ws://127.0.0.1:4190/api/runtime/ws
```

---

# Phase 1 — Workspace Guide

The first assistant can inspect your local workspace.

This is a bounded local read surface.

---

## Configure filesystem MCP

Replace your MCP servers config with:

```json
{
  "name": "filesystem",
  "transport": "stdio",
  "config": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
  }
}
```

Windows:

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "."]
}
```

---

## Create the Workspace Guide assistant

### agents.json

```json
{
  "profiles": {
    "workspace_guide": {
      "model": "qwen3:14b",
      "tools": [
        "read_file",
        "list_directory",
        "directory_tree"
      ],
      "instructions": "You are a workspace guide. Explore the local project structure, summarize architecture, and help users navigate the workspace. Use filesystem tools when needed."
    }
  }
}
```

---

## workflow.nrv

```
on external "user_message"

  result = agent(
    "workspace_guide",
    event.value,
    tools={
      mode: "governed",
      allow: [
        "read_file",
        "list_directory",
        "directory_tree"
      ],
      maxRounds: 4,
      timeoutMs: 20000
    }
  )

  output text result

end
```

---

## Try these prompts

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "How is this project structured?"
```

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Find where MCP integration is configured."
```

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Summarize the architecture philosophy of this project."
```

Observe:

* the model exploring files
* governed tool calls
* explicit execution events
* deterministic orchestration around probabilistic reasoning

### Prove tool execution (not just assistant prose)

Use JSON output and inspect execution events directly:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Find where MCP integration is configured." --json
```

For human-readable lifecycle traces in terminal output:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Find where MCP integration is configured." --verbose
```

For structured tool-only traces (JSON):

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Find where MCP integration is configured." --json --trace-tools
```

If your local model is slow, extend the client wait timeout:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Find where MCP integration is configured." --json --trace-tools --timeout-ms 120000
```

Confirm all of the following in `executionEvents`:

* at least one `tool_call` event for an allowed filesystem tool
* a matching `tool_result` event
* a final `output` event that reflects post-tool reasoning

If you only see an assistant explanation with no `tool_call` / `tool_result`, treat it as model text, not verified tool execution.

---

# Phase 2 — Research Analyst

Now the assistant gains an external read surface.

It can combine local project knowledge with external documentation.

---

## Add fetch MCP server

Add this server to `modules.mcp.servers`:

```json
{
  "name": "web-fetch",
  "transport": "stdio",
  "config": {
    "command": "node",
    "args": ["./mcp-servers/web-fetch.mjs"]
  }
}
```

Create `mcp-servers/web-fetch.mjs`:

```js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'web-fetch', version: '1.0.0' })

server.registerTool(
  'fetch_url',
  {
    description: 'Fetch a URL and return text content',
    inputSchema: {
      url: z.string().url(),
      timeoutMs: z.number().int().positive().max(60000).optional(),
    },
  },
  async (args = {}) => {
    const url = String(args.url ?? '')
    const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Number(args.timeoutMs) : 15000

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await response.text()

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: response.ok,
              status: response.status,
              url,
              contentType: response.headers.get('content-type') ?? '',
              text,
            }),
          },
        ],
      }
    } finally {
      clearTimeout(timer)
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
```

---

## Create the Research Analyst assistant

### agents.json

```json
{
  "profiles": {
    "research_analyst": {
      "model": "qwen3:14b",
      "tools": [
        "read_file",
        "fetch_url"
      ],
      "instructions": "You are a technical research analyst. Compare local project architecture with external technical documentation. Use fetch_url when external context is needed."
    }
  }
}
```

---

## workflow.nrv

```
on external "user_message"

  result = agent(
    "research_analyst",
    event.value,
    tools={
      mode: "governed",
      allow: [
        "read_file",
        "fetch_url"
      ],
      maxRounds: 6,
      timeoutMs: 30000
    }
  )

  output text result

end
```

---

## Try these prompts

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Fetch the MCP specification homepage and explain how this project integrates MCP differently from a typical agent framework."
```

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Compare the manifesto philosophy with the Model Context Protocol design goals."
```

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Fetch the Ollama API docs and explain how they relate to the transport layer in this project."
```

If needed, run the same prompt with a longer client timeout:

```bash
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "Fetch the Ollama API docs and explain how they relate to the transport layer in this project." --timeout-ms 120000
```

Observe:

* local and external reasoning combined
* explicit runtime-governed capability access
* inspectable external retrieval

---

# What you learned

You now have:

* deterministic workflow orchestration
* runtime-governed tool execution
* attachable external capabilities through MCP
* bounded assistant specialization
* inspectable external cognition

The workflow stays inspectable while capabilities scale outward.

Minimal surface. Composable depth.

---

## Reference: MCP module configuration shape

The scaffold writes a config equivalent to:

```json
{
	"requires": {
		"mcp": { "required": true, "provider": "mcp" }
	},
	"modules": {
		"mcp": {
			"provider": "mcp",
			"mode": "embedded",
			"detectToolConflicts": true,
			"servers": [
				{
					"name": "local-mcp",
					"transport": "stdio",
					"config": {
						"command": "node",
						"args": ["./mcp-servers/local-mcp.mjs"]
					}
				}
			]
		}
	}
}
```

## Reference: Transport options

Supported MCP client transports: `stdio`, `sse`, `websocket`.

```json
{ "name": "remote-sse", "transport": "sse", "config": { "url": "https://mcp.example.com/sse" } }
```

```json
{ "name": "remote-ws", "transport": "websocket", "config": { "url": "wss://mcp.example.com/ws" } }
```

## Reference: Behavior notes

- `eagerConnect: true` forces MCP connection during host startup.
- `detectToolConflicts: true` fails startup if two servers expose the same tool name.
- Tool call failures return `{ ok: false, error }`.

## Reference: Troubleshooting

- `Missing module config for required capability "mcp"`:
	add both `requires.mcp` and `modules.mcp`.
- `Unsupported MCP transport`:
	use one of `stdio`, `sse`, `websocket`.
- `Duplicate MCP tool name`:
	rename tools in one server or split server attachment by workspace.
- `stdio transport requires config.command`:
	set `config.command` and verify executable path.
- `validate --json` returns ok but tools still do not execute:
  config wiring passed, but end-to-end tool execution did not. Re-run with `nerve-send --json` and verify `tool_call` + `tool_result` events.
- Need quick terminal diagnostics:
  run `nerve-send --verbose` to print tool lifecycle traces (`tool_call`, `tool_result`, `tool_error`).
- Need structured tool trace payloads:
  run `nerve-send --json --trace-tools` and inspect `toolTrace` for correlation IDs, rounds, and status.

## Reference: Next

- See composable host details: `examples/composable-reference-host/README.md`
- See provider architecture notes: `docs/guide/10-host-db-connectors.md`

If you want to understand *why* Nerveflow is designed this way, read [MANIFESTO.md](../../MANIFESTO.md).
