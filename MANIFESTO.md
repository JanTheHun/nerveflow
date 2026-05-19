# MANIFESTO

Nerveflow is built around a simple idea:

Deterministic systems should orchestrate probabilistic ones.

Large language models are powerful.
But power without structure becomes difficult to inspect, difficult to govern, and difficult to trust.

Nerveflow does not try to hide orchestration behind autonomy.

It makes orchestration explicit.

---

## Minimal surface. Composable depth.

The syntax stays small.

Underneath it:

* workflows
* contracts
* runtime surfaces
* capability composition
* bounded orchestration
* external attachment protocols

A workflow should remain readable even as the system around it grows.

---

## Workflows decide when. Hosts decide how.

A workflow orchestrates execution.

A host realizes capabilities.

The workflow decides:

* when tools execute
* when routing occurs
* when memory is retrieved
* when effects happen

The host decides:

* how capabilities are implemented
* where data comes from
* which protocols attach to runtime
* how the outside world connects

This separation matters.

It keeps orchestration inspectable while allowing systems to grow.

---

## Tools are capabilities, not magic.

A tool is just a capability crossing the runtime boundary.

Sometimes workflows invoke tools directly.

Sometimes models invoke tools through governed orchestration.

Sometimes tools arrive through MCP.

They are still the same capabilities.

The difference is who controls execution.

---

## Runtime first.

The runtime stays small.

It should:

* execute deterministically
* expose stable surfaces
* remain inspectable
* avoid hidden orchestration
* avoid implicit loops

Capabilities attach around the runtime.

Not inside it.

---

## Bounded autonomy over hidden agency.

Nerveflow is not trying to build invisible autonomous systems.

It is trying to build understandable ones.

Models can:

* classify
* route
* retrieve
* generate
* reason

But orchestration should remain visible.

You should be able to answer:

* why did this execute?
* where did this data come from?
* who decided to call this tool?
* what changed state?

without reverse-engineering agent behavior.

---

## Stable surfaces matter.

Workflows outlive transports.

Capabilities outlive protocols.

The same runtime may attach to:

* WebSocket surfaces
* MQTT
* speech systems
* MCP servers
* local tools
* remote infrastructure

The orchestration model should remain stable while the world around it changes.

---

## Compose capabilities. Do not bury them.

A capability should remain ordinary.

Not framework magic.
Not hidden middleware.
Not a mysterious autonomous subsystem.

A capability should be understandable in isolation.

Small systems scale better when composition remains explicit.

---

## Build in the UI. Run beyond it.

Visual tooling matters.

Inspection matters.

But the runtime should not depend on the editor.

A workflow should be able to:

* run locally
* run remotely
* attach through protocols
* survive outside the IDE
* remain observable everywhere

The runtime is the product.
The editor is a surface around it.

---

## The thing that runs your AI thing.

Nerveflow is not trying to become:

* a monolithic agent platform
* an invisible orchestration cloud
* a framework that absorbs every protocol

It is a runtime for composing AI systems with explicit orchestration and attachable capabilities.

Small enough to understand.
Deep enough to grow.

Minimal surface. Composable depth.
