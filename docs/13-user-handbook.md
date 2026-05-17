# User Handbook

This handbook preserves repository-level context and longer-form guidance that does not belong in a splash-style root README.

## Project overview

Nerveflow is a deterministic workflow runtime for AI systems that need explicit control and inspectable execution.

Core focus areas in this repository:

- Runtime and language implementation under `src/`
- CLI tooling under `bin/`
- Host and integration examples under `examples/`
- Studio and remote bridge tooling under `nerve-studio/`
- Platform and language documentation under `docs/`

## Core primitives

Nerveflow is built on three reinforcing primitives:

1. Deterministic Workflow: the execution spine
2. Decision Contracts: the cognition boundary
3. Event and Effect Surface: the world interface

Together they provide bounded autonomy: model flexibility inside explicit runtime control.

## Runtime vs host responsibilities

Runtime responsibilities:

- deterministic execution order
- explicit state transitions
- event routing
- contract validation and bounded failure behavior
- orchestration boundaries for tools, agents, and scripts

Host responsibilities:

- persistence and infrastructure
- external transports and APIs
- ingress connectors and effect realizers
- deployment topology and operational controls

The runtime governs workflow semantics. The host connects workflows to the world.

## Getting started paths

### Path A: Use Nerveflow as a library

```bash
npm install nerveflow
```

```js
import { runNextVScript } from 'nerveflow'

const source = `
on external "user_message"
  state.count = state.count + 1
  output text "count=${state.count}"
end
`

const result = await runNextVScript(source, {
  state: { count: 0 },
  event: { type: 'user_message', value: 'hello' },
})

console.log(result.state.count)
```

### Path B: Use compose + standalone runtime

```bash
npx nerve-compose init
npx nerve-runtime start --port 4190
npx nerve-send ws://127.0.0.1:4190/api/runtime/ws user_message "hello nerve"
```

For full step-by-step onboarding, see [02-getting-started.md](02-getting-started.md).

### Path C: Use repository host examples

Start with [../examples/minimal-web-host](../examples/minimal-web-host) for a minimal reference host.

## API import guidance

For direct scripting:

```js
import { runNextVScript } from 'nerveflow'
```

For runtime/host integration:

```js
import { createRuntimeCore, createRuntimeResolvers } from 'nerveflow/runtime'
import { createHostAdapter } from 'nerveflow/host_core'
```

For legacy naming context and compatibility notes, see [03-language-reference.md](03-language-reference.md).

## Documentation map

Start here:

- [README.md](README.md)
- [01-what-is-nerve.md](01-what-is-nerve.md)
- [02-getting-started.md](02-getting-started.md)
- [03-language-reference.md](03-language-reference.md)
- [04-host-integration.md](04-host-integration.md)
- [05-platform-vision.md](05-platform-vision.md)

Specifications:

- [spec-structured-return-contracts.md](spec-structured-return-contracts.md)
- [spec-late-contract-binding.md](spec-late-contract-binding.md)
- [spec-bounded-control-flow-provenance.md](spec-bounded-control-flow-provenance.md)
- [spec-parallel-group-evaluation.md](spec-parallel-group-evaluation.md)
- [spec-explicit-runtime-failure-envelopes.md](spec-explicit-runtime-failure-envelopes.md)

Operations:

- [11-production-readiness.md](11-production-readiness.md)
- [12-docker-deployment.md](12-docker-deployment.md)

Examples and patterns:

- [examples/multi-surface-attachment-pattern.md](examples/multi-surface-attachment-pattern.md)
- [../examples/](../examples/)
