# Composable Reference Host

This example is a host setup reference, not an application workspace. It embeds the runtime, auto-attaches capabilities from workspace config, attaches a WebSocket surface, and runs against a caller-provided workflow workspace.

## What This Example Owns

- Host construction with `createComposableHost()`
- Workspace-driven capability auto-attachment
- Surface attachment for WebSocket access
- Host lifecycle startup and shutdown

## What This Example Does Not Own

- `nerve.json`
- workflow files
- application routing logic
- behavior definitions

Those come from the workspace passed to the host at startup.

## Usage

Start the host against an existing workspace that already contains its own runtime config and workflow files.

You can pass either a repository-relative path or an absolute path to a project folder.

If omitted, the current working directory is used as the workspace.

```bash
WORKSPACE_DIR=examples/my-workspace PORT=4190 node examples/composable-reference-host/server.js
```

Current working directory as workspace:

```bash
node examples/composable-reference-host/server.js
```

Absolute external project path:

```bash
WORKSPACE_DIR=/path/to/my-project PORT=4190 node examples/composable-reference-host/server.js
```

Capability flow:

1. Declare required capabilities in workspace config (`nerve.json` or `nextv.json`) under `requires` and `modules`
2. Start composable-reference-host against that workspace

For memory-pgvector capabilities, configure these environment variables as needed:

- `MEMORY_DB_URL`
- `MEMORY_EMBEDDING_MODEL`
- `MEMORY_EMBEDDING_BASE_URL`
- `MEMORY_EMBEDDING_DIMENSIONS`
- `MEMORY_POOL_MIN`
- `MEMORY_POOL_MAX`

Or pass the workspace as the first positional argument:

```bash
node examples/composable-reference-host/server.js examples/memory-agent
```

Output:

```
🌐 Composable Reference Host
📁 Workspace: C:\path\to\your\workspace
🔌 Port: 4190

📦 Attaching capabilities from workspace config...

📡 Attaching surfaces...
  ✓ WebSocket surface

🚀 Starting host...
✅ Host running
📍 WebSocket: ws://127.0.0.1:4190/api/runtime/ws
```

## Host Assembly

```javascript
const host = createComposableHost({
  repoRoot: workspaceAbsolutePath,
  workspaceDir: '.',
  autoAttachCapabilitiesFromWorkspace: true,
  port,
  callAgent,
})

host.attachSurface(wsSurface({ path: '/api/runtime/ws' }))

await host.start()
```

The runtime loads and executes workflow from the supplied workspace, and capabilities are resolved from workspace `requires/modules` declarations.

## Supported Module Providers (Auto-Attach)

- `memory-pgvector` -> storage capability with local vector provider
- `speech-surface` -> speech capability
- `mcp` / `mcp-client` -> MCP capability

## WebSocket Access

```javascript
const ws = new WebSocket('ws://127.0.0.1:4190/api/runtime/ws')
```

Any commands and events travel to the runtime loaded from the caller workspace, not from this example directory.

## Environment Variables

When starting, this host attempts to load `.env` from the target workspace directory.

- Values already present in the process environment are preserved.
- Missing values from `.env` are injected into `process.env` before runtime startup.

This allows workspace config entries like `${env:OPENAI_BASE_URL}` to resolve without requiring a separate shell export step.

This host uses the OpenAI-compatible transport by default for `agent()` / `model()` calls. The resolved transport configuration from workspace `transports` and `models` is passed through to the request layer.

## Notes

- Ensure the target workspace contains its own runtime configuration (`nerve.json` or `nextv.json`) and workflow files.
- Use `nerve-compose add <capability>` to write workspace capability declarations.
