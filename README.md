# Nerveflow

**Deterministic control for AI workflows.**

Nerveflow defines how your system actually runs, with explicit control flow, visible state, and predictable behavior.

Instead of hiding logic inside prompts or agent loops, Nerveflow makes routing, state, and side effects explicit. Your workflow is a script. Every step is inspectable. Every decision has a place.

---

## What Nerveflow does

- deterministic execution of workflows
- explicit event routing (`on`, `emit`)
- persistent, inspectable state (`state.*`)
- structured orchestration of agents and tools
- compact expression support for arithmetic, comparisons, and logical checks

## What Nerveflow does *not* do

- manage databases or persistence layers
- define how APIs, files, or images are transported
- hide behavior inside autonomous agent loops

Those responsibilities belong to your **host environment**.
Nerveflow stays focused on control.

---

## Hello Nerveflow

```wfs
on external "user_message"
  state.count = state.count + 1
  doubled = state.count * 2
  print "(${state.count}) You said: ${event.value}"
  print "double-count=${doubled}"
end
```

A workflow is just a script that runs on every event.

---

## Example: simple router

```wfs
on external "user_message"
  emit("triage", event.value)
end

on "triage"
  result = agent("classifier", event.value, format="json")

  if result.intent == "chat"
    emit("chat_flow", event.value)
  else if result.intent == "search"
    emit("search_flow", event.value)
  else
    emit("fallback", event.value)
  end
end

on "chat_flow"
  reply = agent("chat", event.value)
  emit("user_output", reply)
end

on "search_flow"
  reply = agent("searcher", event.value)
  emit("user_output", reply)
end

on "fallback"
  emit("user_output", "I didn't understand that.")
end

on "user_output"
  output text event.value
end
```

Routing is explicit.
State is explicit.
Nothing is hidden inside prompts.

---

## Runtime vs Host

**Nerveflow runtime**

- deterministic execution
- event routing
- explicit state (`state.*`)
- agent / tool orchestration

**Host (your app)**

- persistence (files, DB, etc.)
- APIs and integrations
- input formats (text, images, files)
- deployment (CLI, web, backend)

---

## Philosophy & Scope

### What Nerveflow focuses on

Nerveflow is intentionally focused on **control flow and execution semantics**.

It defines:

- how workflows run
- how state evolves
- how decisions are routed

Everything else — integrations, persistence layers, external APIs, multimodal inputs — belongs to the host environment.

### What's evolving around it

Additional layers are being built around the core:

- host integrations (APIs, databases, external systems)
- persistence adapters (file, DB, distributed state)
- testing and evaluation tooling for workflows

These evolve **without changing how workflows are written**.

Because workflows are deterministic and state is explicit, Nerveflow is designed to support reproducible testing and evaluation. Tooling around this is under active development.

### Why this approach

If the core is right, everything else can grow around it.
If the core is wrong, features won't fix it.

Nerveflow is built by getting the core right first.

---

## Getting started

### 1. Install

```bash
npm install nerveflow
```

### 2. Run the example host

```bash
cd node_modules/nerveflow/examples/minimal-web-host
npm install
node server.js
```

Open `http://127.0.0.1:4173` in your browser. Write scripts, run them, inspect state and execution events.

### 3. Use in your code

```js
import { runNextVScript } from 'nerveflow'

const result = await runNextVScript(`
state.count = state.count + 1
remaining = 10 - state.count
output text "count=${state.count}"
output text "remaining=${remaining}"
`, {
  state: { count: 0 },
})

console.log(result.state.count)
```

---

## Learn more

- [Full documentation](./docs/)
- [Language reference](./docs/03-language-reference.md)
- [Host integration guide](./docs/04-host-integration.md)
- [Runtime module notes](./src/runtime/README.md)
- [Example workflows](./docs/examples/)

Expression note: Nerveflow supports `+`, `-`, `*`, `/`, comparisons, and logical operators directly in workflow expressions. See the language reference for precedence and coercion rules.

---

## Standalone runtime + attach

Run Nerveflow as a dedicated runtime process:

```bash
node bin/nerve-runtime.js start examples/mqtt-simple-host --port 4190
```

Attach from another terminal:

```bash
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws snapshot
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws enqueue user_message hello
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws stop
```

Stream runtime events:

```bash
node bin/nerve-attach.js ws://127.0.0.1:4190/api/runtime/ws listen
```

See the host guide for full details and protocol semantics: [Host integration guide](./docs/04-host-integration.md).

---

## Run tests

```bash
npm test
```

---

## Status

Nerveflow is a stable, early-stage project focused on the core runtime and workflow model.

The execution model, state handling, and DSL are stable and maturing.
Integrations, persistence adapters, and testing tools are evolving around it.

---

## License

MIT

