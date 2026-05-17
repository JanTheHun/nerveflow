# Nerveflow

**Deterministic control for probabilistic software.**

Nerveflow is a runtime authority for AI systems that need explicit control, visible execution, and bounded interaction with the world.

This runtime model is stable, while surrounding host surfaces continue to evolve.

It gives probabilistic systems a deterministic execution spine:

- explicit routing
- inspectable state
- declared effects
- bounded model decisions
- attachable runtime surfaces

Instead of hiding behavior inside prompt-only loops, Nerveflow makes workflow control part of the runtime itself.

## Three primitives

Nerveflow is built on three reinforcing primitives:

1. Deterministic Workflow: the execution spine
2. Decision Contracts: the cognition boundary
3. Event and Effect Surface: the world interface

Together they create bounded autonomy:

> model flexibility inside explicit control

If the core is right, everything else can evolve around it.
If the core is wrong, features will not save it.
## Runtime topology

Nerveflow can run as a single-session runtime authority with attached surfaces.

Surfaces may:

- observe execution
- enqueue events
- realize effects
- attach and detach independently of runtime execution (for supported surfaces)

Examples:

- Studio UI
- WebSocket clients
- MQTT observability bridges
- embedded device hosts
- CLI attach tools

The runtime owns execution.
Surfaces attach to it.

## What this means in practice

- workflow control flow is explicit and inspectable
- routing-critical model calls can be contract-bounded
- retries and violation handling are part of workflow logic
- effects happen through declared channels and events
- runtime execution is deterministic within defined workflow/runtime semantics
- host integrations stay outside runtime semantics

## What Nerveflow is not

- not a database or persistence layer
- not an infrastructure provisioning tool
- not an autonomous hidden agent loop framework

Those concerns belong to the host environment.

## Start in 60 seconds

Run the reference host from this repository:

```bash
cd examples/minimal-web-host
npm install
npm start
```

Then open `http://127.0.0.1:4173`, paste or edit a workflow, and run it.

For additional setup paths, see [Getting started](./docs/02-getting-started.md).

## Quick language feel

```nrv
on external "user_message"
  intent = agent(
    "router",
    event.value,
    decide=["chat","search","other"],
    retry_on_contract_violation=1,
    on_contract_violation=emit("contract_violation", violation)
  )

  if intent == "chat"
    emit("chat_flow", event.value)
  else if intent == "search"
    emit("search_flow", event.value)
  else
    emit("route_unclear", event.value)
  end
end

on "route_unclear"
  output text "Do you want chat help or search help?"
end

on "contract_violation"
  output text "I did not understand that safely. Please rephrase."
end
```

Minimal surface. Hidden depth.

That small contract boundary can provide, depending on configuration:

- runtime validation
- bounded retries
- deterministic routing
- explicit failure handling

Expression support includes arithmetic (`+`, `-`, `*`, `/`), comparisons, and logical operators.

## Failure envelopes with try

For supported `agent(...)` and `model(...)` operations, `try` can convert supported operational/contract failures into explicit envelope values.

```nrv
on external "user_message"
  result = try agent("router", event.value, decide=["chat", "search", "other"])

  if result.ok
    emit("route", result.value)
  else
    output text "I hit a guarded failure: ${result.error.type}"
  end
end
```

See [Language reference](./docs/03-language-reference.md) and [explicit runtime failure envelopes](./docs/spec-explicit-runtime-failure-envelopes.md) for supported modes and limits.

## Runtime vs host

Runtime responsibilities:

- deterministic execution order
- event routing and state transitions
- contract validation and binding
- bounded control flow
- orchestration boundaries for tools, agents, and scripts

Host responsibilities:

- persistence and infrastructure
- APIs and external integrations
- ingress connectors
- effect realizers
- transport surfaces
- deployment and operational topology

The runtime governs execution.
Hosts connect it to the world.

## Getting started

Choose the path that matches your goal.

### Path A: Use Nerveflow as a library

```bash
npm install nerveflow
```

```js
import { runNextVScript } from 'nerveflow'

const source = `
on external "user_message"
  state.count = state.count + 1
  output text "count=\${state.count}"
end
`

const result = await runNextVScript(source, {
  state: { count: 0 },
  event: { type: 'user_message', value: 'hello' },
})

console.log(result.state.count)
```

### Path B: Run a reference host from this repository

```bash
cd examples/minimal-web-host
npm install
npm start
```

Then open `http://127.0.0.1:4173`.

### Path C: Run standalone runtime + attach

```bash
npx nerve-runtime start examples/mqtt-simple-host --port 4190
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws snapshot
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws enqueue user_message hello
npx nerve-attach ws://127.0.0.1:4190/api/runtime/ws listen
```

## Public APIs

Recommended subpath imports:

```js
import { createHostAdapter } from 'nerveflow/host_core'
import { createRuntimeCore, createRuntimeResolvers } from 'nerveflow/runtime'
```

Top-level runtime helper imports remain in a compatibility window, but new integrations should use `nerveflow/runtime`.

### Naming transition

Nerveflow and nerve are the canonical public names going forward.

Some APIs, config filenames, and protocol identifiers still use legacy nextv naming as part of a compatibility transition. For new integrations, prefer nerve and nerveflow terminology in docs, code, and host surface naming.

Legacy nextv names remain supported during this transition window. We plan to continue cleaning up legacy nextv terminology in future releases, with explicit migration guidance before compatibility removals.

## Docs map

Start here:

- [Documentation index](./docs/README.md)
- [What is Nerveflow](./docs/01-what-is-nerve.md)
- [Getting started](./docs/02-getting-started.md)
- [Language reference](./docs/03-language-reference.md)
- [Host integration guide](./docs/04-host-integration.md)
- [Multi-surface attachment pattern](./docs/examples/multi-surface-attachment-pattern.md)
- [Platform vision](./docs/05-platform-vision.md)

Workflow generation docs:

- [Project generator guide](./docs/project-generation/project-generator-guide.md)
- [Workflow generation rules](./docs/project-generation/workflow-generation-rules.md)
- [Agent language reference (project generation)](./docs/project-generation/agent-language-reference.md)
- [Workflow checklists](./docs/project-generation/workflow-checklists.md)
- [Canonical snippets](./docs/project-generation/canonical-snippets.md)

Operations:

- [Production readiness](./docs/11-production-readiness.md)
- [Docker deployment](./docs/12-docker-deployment.md)

## Status

Nerveflow is stable in the core runtime and language layer:

- deterministic execution model
- explicit event/effect semantics
- contract-bounded model call behavior

Surrounding ecosystem layers are active work areas and evolving quickly:

- host module composition
- connector and effect adapters
- workflow evaluation and tooling

## Development

Run tests:

```bash
npm test
```

Packaged runtime smoke check:

```bash
npm run test:pack-smoke
```

## License

MIT

