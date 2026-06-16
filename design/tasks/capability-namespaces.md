# Capability Namespaces

**Status:** implemented (namespace dispatch and collision detection live; workflow-backed capabilities with canonical `namespace.operation` identity complete)

## Purpose

Provide a stable, collision-free naming model for workflow-callable capabilities.

Capability namespaces make capability origin explicit while preserving the existing workflow execution model.

This proposal applies equally to:

* host-provided tools
* host-module providers
* MCP servers
* future capability providers

The workflow should consume capabilities through a single naming system regardless of implementation source.

---

## Motivation

Current capability exposure often relies on flat tool names:

```text
get_time
memory_store
memory_retrieve
http_fetch
rss_fetch
```

This creates several problems:

### Naming collisions

Two providers may expose the same tool name:

```text
query
```

Example:

```text
knowledge-base MCP
  query

postgres MCP
  query

vector-memory MCP
  query
```

Flat namespaces require:

* startup failures
* silent overrides
* arbitrary precedence

None are desirable.

---

### Prefix conventions leak abstraction

Current patterns often encode namespaces inside names:

```text
memory_store
memory_retrieve
rss_fetch
```

The namespace already exists.

It is simply represented as a string convention.

---

### Capability origin becomes unclear

Given:

```nrv
tool("query", ...)
```

It is impossible to know:

* which provider owns the tool
* whether it came from MCP
* whether it came from a host module
* whether another provider exposes the same capability

---

## Core Idea

Capabilities are exposed through:

```text
namespace.operation
```

Examples:

```text
time.now

memory.store
memory.retrieve

http.fetch
rss.fetch

filesystem.read_file
filesystem.list_directory

qmd.query
```

A capability identity consists of:

```text
<namespace>.<operation>
```

Both segments are required.

---

## Capability Provider Model

Providers expose capabilities grouped under a namespace.

Example:

```json
{
  "namespace": "memory",
  "tools": [
    "store",
    "retrieve"
  ]
}
```

Equivalent workflow usage:

```nrv
result = tool("memory.retrieve", {
  query: event.value
})
```

---

## MCP Mapping

MCP servers become capability providers.

Example:

```text
qmd
  query
```

Workflow:

```nrv
result = tool("qmd.query", {
  text: event.value
})
```

Another server:

```text
filesystem
  read_file
  write_file
  list_directory
```

Workflow:

```nrv
files = tool("filesystem.list_directory", {
  path: "/docs"
})
```

No special MCP naming rules are required.

MCP servers participate in the same capability system as every other provider.

---

## Built-In Capability Migration

Current:

```text
get_time
http_fetch
rss_fetch
```

Proposed:

```text
time.now
http.fetch
rss.fetch
```

Current:

```text
memory_store
memory_retrieve
```

Proposed:

```text
memory.store
memory.retrieve
```

The existing naming pattern becomes explicit.

---

## Host Aliases

Hosts may define aliases.

Example:

```json
{
  "tools": {
    "kb_query": "qmd.query"
  }
}
```

Workflow:

```nrv
tool("kb_query", ...)
```

Alias resolution occurs before capability lookup.

Aliases are optional convenience features and do not replace canonical capability identities.

Alias invariants:

* an alias maps to exactly one canonical capability identity
* an alias must be globally unique
* an alias cannot equal any canonical `namespace.operation` identity
* alias chains are not allowed

Alias collisions should fail at startup.

---

## Runtime Resolution

Resolution order:

```text
tool("memory.retrieve") or tool("memory_store")
  ↓
if alias: resolve alias once to canonical id
       ↓
namespace = memory
operation = retrieve
       ↓
provider lookup
       ↓
capability execution
```

If namespace does not exist:

```text
CAPABILITY_NAMESPACE_NOT_FOUND
```

If operation does not exist:

```text
CAPABILITY_NOT_FOUND
```

If canonical capability identity is already registered:

```text
CAPABILITY_ALREADY_REGISTERED
```

If alias collides with canonical ids or existing aliases:

```text
ALIAS_CONFLICT
```

---

## Introspection

Capability discovery naturally becomes hierarchical.

Example:

```json
{
  "memory": [
    "store",
    "retrieve"
  ],
  "filesystem": [
    "read_file",
    "write_file",
    "list_directory"
  ],
  "qmd": [
    "query"
  ]
}
```

This structure can be surfaced through:

* Studio
* runtime snapshots
* host diagnostics
* future capability inspection APIs

---

## Relationship To Existing Architecture

This proposal does not change workflow semantics.

It only changes capability naming.

The existing architectural boundary remains:

* workflows decide when capabilities execute
* hosts decide how capabilities are implemented

Capability namespaces make provider boundaries visible without exposing implementation details.

---

## Compatibility and Ergonomics

Canonical capability identities are always `namespace.operation`.

Legacy flat names may be supported through aliases as a permanent host feature.

Example:

```text
memory_store    → memory.store
memory_retrieve → memory.retrieve
get_time        → time.now
```

This keeps workflow ergonomics and compatibility flexible while preserving one canonical capability identity model.

---

## Design Principles

### Explicit Origin

Capability identity should reveal ownership.

### Collision-Free

Different providers should never compete for the same global name.

### Provider-Agnostic

MCP servers, host modules, and future capability providers use the same model.

### Stable Contracts

Workflows depend on capability contracts, not implementation source.

### Consistent Composition

Capability namespaces align with the broader Nerveflow architecture:

```text
namespace.operation
```

just as:

```text
agent.profile
transport.model
effect.channel
```

represent explicit compositional boundaries.

---

## One-Line Summary

Capability namespaces expose workflow-callable capabilities as `namespace.operation`, providing collision-free capability composition across host modules, MCP servers, and future providers while preserving deterministic workflow semantics.
