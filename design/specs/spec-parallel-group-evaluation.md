## Parallel Group Evaluation (MVP v1 Final)

---

# Purpose

Evaluate multiple independent agent/model calls as a group, optionally execute them concurrently, and return results in deterministic input order.

This construct provides explicit, inspectable concurrency boundaries while preserving deterministic runtime semantics.

---

# Syntax

```nrv
results = parallel([
  agent(...),
  model(...),
  ...
])
```

Each element must be a **direct call expression**:

- `agent(...)`
- `model(...)`

---

# Language Construct (Not a Function)

`parallel([...])` is a **language-level construct**, not a regular runtime function call.

### Rationale

The runtime currently eagerly evaluates function arguments. If `parallel` were implemented as a normal function, inner calls would execute before `parallel` control is applied, eliminating both grouping semantics and concurrency control.

### Implementation requirements

- Parser MUST produce a dedicated AST node (`type: 'parallel'`)
- Compiler MUST NOT lower to a generic call op; the expression node passes through to runtime as-is
- Runtime MUST evaluate child calls lazily under grouped control, using a shared context snapshot

---

# Semantics

## 1. Independence

- Calls MUST be logically independent
- Calls MUST NOT depend on each other's outputs

### Important

Independence is a **semantic author contract** and is not fully statically provable. Parser/runtime enforce syntactic restrictions only. Author is responsible for ensuring true independence.

---

## 2. Side Effects (Phase 1)

Parallel children are **side-effect-free**.

Disallowed inside `parallel([...])` children:

- `emit(...)`
- `output ...`
- `state` mutation
- `on_contract_violation` handlers

### Rationale for on_contract_violation exclusion

`on_contract_violation` can emit events, which breaks both the independence model and deterministic isolation. It is excluded in Phase 1.

Parser MUST reject `on_contract_violation` inside parallel child calls.

---

## 3. Element Validity

Each element inside `parallel([...])` MUST be a direct `agent(...)` or `model(...)` call expression.

### Disallowed forms

```nrv
parallel([
  x,                        # variable reference
  some_wrapper(agent(...)), # nested call
])
```

### Allowed

```nrv
parallel([
  agent("music", event.value, returns={ type:["music","other"], confidence:0 }),
  model("default", event.value),
])
```

Parser MUST enforce this strictly.

---

## 4. Snapshot Semantics

All child calls observe the same **pre-parallel snapshot** of:

- `locals`
- `state`
- `event`

### Implications

- Child argument evaluation is context-identical for all children
- No child observes effects from another child
- Snapshot rule applies in both concurrent and sequential execution modes

---

# Execution Model

All child calls are evaluated as a group. Execution completes when all children complete.

`parallel([...])` expresses **independence**, not guaranteed concurrency.

## Capability-Aware Execution

- If the runtime/adapter supports concurrency, calls SHOULD execute concurrently
- Otherwise, calls MUST execute sequentially

## Guarantees (Both Modes)

- Output MUST be identical regardless of execution mode
- Result ordering MUST be preserved (input index order)
- Failure semantics MUST be deterministic

Only latency may differ.

---

# Capability Source

Concurrency capability may be surfaced at:

- provider layer
- transport layer
- host adapter layer
- runtime session layer

Capability is not limited to a provider object.

### Conceptual shape

```js
capabilities = {
  concurrentExecution: true
}
```

---

# Ordering

```nrv
parallel([A, B, C]) → [resultA, resultB, resultC]
```

- Result order always matches input order
- Execution order is not observable through the result array

---

# Observability

- Result ordering is guaranteed
- Telemetry events (`tool_call`, `tool_result`, trace) MAY interleave in concurrent mode
- Runtime telemetry normalization is optional in MVP
- Telemetry timestamps are wall-clock timestamps at emission time; logical-time reordering is not required in MVP

---

# Error Handling (Deterministic)

## Rule

> If any child call fails, the entire `parallel` expression fails.

## Deterministic failure selection

If multiple children fail:

> Surface the failure from the **lowest input index**.

## Cancellation (Phase 1 non-goal)

Phase 1 does **not** guarantee cancellation of in-flight calls. Runtime may await full settlement before surfacing the selected failure, consistent with an `allSettled` collection approach.

## Reference execution pattern

```js
async function execParallel(nodes, caps) {
  if (caps.concurrentExecution) {
    const results = await Promise.allSettled(nodes.map(exec))
    const idx = results.findIndex(r => r.status === 'rejected')
    if (idx !== -1) throw results[idx].reason
    return results.map(r => r.value)
  } else {
    const out = []
    for (const node of nodes) {
      out.push(await exec(node))
    }
    return out
  }
}
```

---

# Return Value

```
Array<Result>
```

Each element is identical to the standalone call result of the corresponding child.

---

# Edge Cases

## Empty

```nrv
parallel([]) → []
```

## Single element

```nrv
parallel([agent(...)]) → [result]
```

---

# Contract Shape Note

Single-item string arrays are **not** valid enum constraints.

**Avoid:**

```nrv
returns={ text:["pong"] }
```

**Use instead:**

```nrv
returns={ text:"" }           # unconstrained string
returns={ text:["pong","other"] }  # real enum (two or more values)
```

---

# Determinism

- Same inputs and environment produce same outputs under deterministic runtime assumptions
- Execution mode MUST NOT affect result semantics
- Failure selection MUST be deterministic (lowest failing index)
- Result ordering MUST be deterministic (input index order)

---

# Diagnostics (Error Code Family)

Consistent parser/runtime error codes for `parallel` misuse:

| Code | Trigger |
|------|---------|
| `PARALLEL_INVALID_SYNTAX` | Argument is not a single array literal |
| `PARALLEL_INVALID_ELEMENT` | Element is not a direct `agent()` or `model()` call |
| `PARALLEL_ON_CONTRACT_VIOLATION_FORBIDDEN` | Child uses `on_contract_violation` |
| `PARALLEL_STANDALONE_FORBIDDEN` | `parallel([...])` used without assignment |

All diagnostics include source line and element index where applicable.

---

# Conformance Matrix

| Case | Input | Expected |
|------|-------|----------|
| Empty | `parallel([])` | `[]` |
| Single success | `parallel([agent(...)])` | one-element array |
| Multi-success | `parallel([A, B, C])` | `[rA, rB, rC]` in input order |
| Multi-failure | `parallel([A, B, C])` where B and C fail | fail with B's error (index 1) |

---

# Design Constraints (Phase 1)

- Explicit language construct boundary
- Side-effect-free child set
- Direct call expressions only
- Shared snapshot semantics
- Deterministic result ordering by input index
- Deterministic failure selection by lowest failing index
- No implicit parallelism outside construct

---

# Non-Goals (Phase 1)

- Partial success returns
- Per-call timeout controls
- Cancellation guarantees for in-flight calls
- Batching
- Nested `parallel`
- Side-effectful child behavior
- Scheduler policy controls

---

# Full Example

```nrv
on external "user_message"

  results = parallel([
    agent("music", event.value, returns={ type:["music","other"], confidence:0 }),
    agent("calendar", event.value, returns={ type:["calendar","other"], confidence:0 }),
    agent("search", event.value, returns={ type:["search","other"], confidence:0 })
  ])

  best = pick_best(results)

  if best.type == "music"
    emit("music_flow", event.value)
  else if best.type == "calendar"
    emit("calendar_flow", event.value)
  else if best.type == "search"
    emit("search_flow", event.value)
  else
    output text "Not sure what you mean"
  end

end
```

---

# One-Liner

> `parallel([...])` defines an explicit group of independent calls evaluated under a shared context snapshot — concurrency is optional, determinism is mandatory.
