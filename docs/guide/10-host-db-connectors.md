# Host DB Connectors

This page focuses on the recommended path for database-backed capabilities: scaffold a local reference host, then auto-attach composable capabilities from workspace config.

If you need manual provider wiring and low-level host-modules composition, see [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md).

## Recommended path: local reference host (composable profile)

The composable path keeps workflow semantics deterministic while moving infrastructure binding into workspace configuration and host capability factories.

Reference hosts provide learnable starting points.

Typical flow:

```bash
# 1) Declare capability in workspace config
npx nerve-compose add memory-pgvector <workspaceDir>

# Optional: scaffold MCP capability and local sample server
npx nerve-compose add mcp <workspaceDir>

# 2) Validate resolved bindings before host startup
npx nerve-compose validate <workspaceDir> --json

# 3) Scaffold a local host baseline into your workspace
npx nerve-compose add host composable <workspaceDir>

# 4) Run host from your workspace
cd <workspaceDir>
node host/server.js
```

## Workspace contract

The registry files for models and transports already work the same way as `agents.json`: `nerve-compose add model` and `nerve-compose add transport` now default to writing `models.json` and `transports.json` at the workspace root for new registries. If inline `nerve.json` / `nextv.json` registry blocks already exist, compose preserves those inline writes for compatibility. Composable capabilities stay separate and continue to use their own generated folders.

`nerve-compose add memory-pgvector` writes capability declarations into workspace config (`nerve.json`, or `nextv.json` fallback), including:

- `requires.memory`
- `modules.memory.provider = memory-pgvector`

At startup, the composable host resolves module provider labels into capability factories and attaches tool providers/connectors/realizers.

`nerve-compose add memory-pgvector` also scaffolds workspace-local helper scripts:

- `capabilities/memory/db-helpers/memory-setup.js`
- `capabilities/memory/db-helpers/memory-health.js`

It now appends missing memory keys to both `.env.example` and `.env`.
Sensitive values in `.env` are scaffolded with mock placeholders (for example, a mock `MEMORY_DB_URL`) and should be replaced before connecting to real infrastructure.
If you prefer to fill sensitive values manually, run memory scaffold with `--blank` so sensitive fields are added with empty values.

These are optional manual utilities. Compose does not provision Postgres and does not run DB setup automatically.

Run them explicitly when needed:

```bash
cd <workspaceDir>
MEMORY_DB_URL=postgres://user:pass@localhost:5432/your_db node capabilities/memory/db-helpers/memory-setup.js
MEMORY_DB_URL=postgres://user:pass@localhost:5432/your_db node capabilities/memory/db-helpers/memory-health.js
```

## Stable provider labels

Current composable auto-attach provider labels:

- `memory-pgvector`
- `speech-surface`
- `mcp` (alias: `mcp-client`)

MCP module config can optionally include:

- `eagerConnect: true` to connect at host startup
- `detectToolConflicts: true` to fail fast on duplicate MCP tool names

## MCP Configuration Patterns

Use `npx nerve-compose add mcp <workspaceDir>` to scaffold MCP wiring and a local sample server.

Default scaffolding keeps module behavior in workspace config and externalizes server topology:

In `nerve.json` (or `nextv.json`):

```json
{
	"modules": {
		"mcp": {
			"provider": "mcp",
			"mode": "embedded",
			"detectToolConflicts": true,
			"configPath": "./capabilities/mcp/mcp.json"
		}
	}
}
```

In `capabilities/mcp/mcp.json`:

```json
{
	"servers": [
		{
			"name": "local-mcp",
			"transport": "stdio",
			"config": {
				"command": "node",
				"args": ["./capabilities/mcp/servers/local-mcp.mjs"]
			}
		}
	]
}
```

External MCP config is servers-only. Keep `mode`, `detectToolConflicts`, and `eagerConnect` in `modules.mcp`.

If you want a single-file setup, use inline mode:

```bash
npx nerve-compose add mcp <workspaceDir> --inline
```

Inline mode stores `servers` directly under `modules.mcp`.

## Validation and failure model

Use `nerve-compose validate` as the preflight gate for package workflows:

- confirms required capabilities are resolvable
- reports resolved capability bindings
- fails early on unsupported provider labels or missing workspace setup

For memory capability, `MEMORY_DB_URL` must be provided through workspace environment before runtime use.

## Architecture boundary (unchanged)

The composable path still follows the same boundary:

- workflows express intent through stable tool contracts
- host capability adapters handle infrastructure behavior
- runtime execution remains deterministic and inspectable

## References

- [examples/composable-reference-host/server.js](../../examples/composable-reference-host/server.js) (reference source)
- [src/host_core/composable_host.js](../../src/host_core/composable_host.js)
- [src/host_core/capabilities/storage.js](../../src/host_core/capabilities/storage.js)
- [src/host_core/providers/local_vector.js](../../src/host_core/providers/local_vector.js)
- [tests/composable_host.test.js](../../tests/composable_host.test.js)
- [tests/composable_reference_host_example.test.js](../../tests/composable_reference_host_example.test.js)
- [10-host-db-connectors-low-level.md](10-host-db-connectors-low-level.md)