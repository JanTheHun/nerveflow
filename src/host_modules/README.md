# Host-Modules Layer

Provides capability composition for Nerveflow runtime: builtin tool providers, workspace provider discovery, and provider ordering for deterministic tool dispatch.

## Overview

The host-modules layer is the bridge between Nerveflow's deterministic runtime (which has no domain concerns) and domain-specific capabilities (tools like RSS fetching, API calls, storage). It composes providers at runtime startup and feeds them to the host-core tool runtime.

**Key Design:**
- Host-core remains substrate-only: just dispatch contracts and policy enforcement
- Host-modules provides capabilities: builtin providers + workspace extension points
- Provider ordering: builtin first, workspace providers after; first handler wins
- Safe failures: missing workspace directory non-fatal, invalid provider files logged and skipped

## Structure

```
src/host_modules/
├── index.js                  # Public API: loadHostModules, createRuntimeBuiltinToolProvider
├── loader.js                 # Workspace provider discovery and composition
├── builtin/
│   ├── index.js              # Re-export builtin provider
│   └── tools.js              # Implementation: get_time, http_fetch, rss_fetch
└── README.md                 # This file
```

## Usage: Runtime Startup

In bin/nerve-runtime.js:

```javascript
import { loadHostModules } from '../src/host_modules/index.js'
import { createToolRuntime } from '../src/host_core/index.js'

// Discover and compose providers from workspace
const providers = await loadHostModules({ workspaceDir: process.cwd() })
const toolRuntime = createToolRuntime(providers)

// Pass to runtime composition
const runtime = createNextVRuntimeCore({ toolRuntime, ... })
```

## Usage: Custom Providers

### Register a workspace provider

Create host_modules/index.js in your workspace:

```javascript
export function createMyDomainProvider() {
  return {
    poll_next_article: async ({ args }) => { ... },
    store_article: async ({ args }) => { ... },
  }
}
```

Then in bin/nerve-runtime.js:

```javascript
const providers = await loadHostModules({ workspaceDir: process.cwd() })
// Workspace provider is now included in the loaded providers list
```

### Builtin Providers

Three tools are provided by default:

1. **get_time** — returns current UTC time
   ```javascript
   tool get_time args { timeZone: "UTC" } -> result { iso, epochMs, timeZone }
   ```

2. **http_fetch** — HTTP request with JSON parsing
   ```javascript
   tool http_fetch args { url, method?, headers?, body?, timeoutMs? } -> result { ok, status, contentType, text, json }
   ```

3. **rss_fetch** — Fetch and parse RSS/Atom feeds
   ```javascript
   tool rss_fetch args { url?, urls?, limit?, timeoutMs? } -> result { count, items[] }
   ```

## Provider Semantics

### Function-based providers

A provider function returns a map of tool name → handler:

```javascript
function createMyProvider() {
  return {
    tool_a: async ({ args }) => { /* return result */ },
    tool_b: async ({ args }) => { /* return result */ },
  }
}
```

### Ordering and dispatch

Provider order matters. When a workflow calls a tool:

1. Policy enforcement (alias resolution, allowlist check) in host-core
2. Tool dispatch via createToolRuntime:
   - Iterate providers in order
   - First provider with handler for tool name wins
   - Others skipped
3. Invoke handler, return result or propagate unknown-tool error

### Error handling

- Missing workspace directory: logged at info, non-fatal
- Invalid provider file: logged at warning, continue with others
- Tool handler throws: propagate to workflow as tool_error event
- Unknown tool (no provider handles it): propagate as unknown-tool error

## Testing

See tests/host_modules.test.js for:
- Builtin provider composition
- Workspace discovery (missing directory tolerance)
- Provider fallthrough and ordering
- Error handling (invalid files, unknown tools)

## Migration Path

If you're migrating from src/runtime/runtime_tools.js:

**Old way:**
```javascript
import { createRuntimeBuiltinToolProvider } from '../src/runtime/runtime_tools.js'
```

**New way (same, re-exported):**
```javascript
import { createRuntimeBuiltinToolProvider } from '../src/runtime/index.js'
// or directly:
import { createRuntimeBuiltinToolProvider } from '../src/host_modules/builtin/index.js'
```

The re-export ensures backward compatibility during transition. Direct imports from host-modules are recommended for new code.
