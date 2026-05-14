# Explicit Runtime Failure Envelopes (`try`) — Draft

Status: draft

## Purpose

Introduce a lightweight, explicit mechanism for converting operational runtime failures into deterministic workflow values.

This is not exception handling.

It is explicit failure-to-value conversion.

The goal is to strengthen Nerveflow's philosophy of deterministic structure governing probabilistic and operational uncertainty.

## Motivation

Nerveflow already provides explicit boundedness for model uncertainty through:

- return contracts
- retries
- contract violation routing
- late contract binding (`try_bind`)

Examples:

```nrv
result = try_bind(raw, contract)

if result.ok
  ...
else
  ...
end
```

and:

```nrv
agent(
  ...,
  on_contract_violation=emit(...)
)
```

These mechanisms treat uncertainty as explicit runtime state, explicit events, and deterministic control flow.

However, other runtime operations still fail through termination behavior:

- `tool(...)`
- `script(...)`
- `operator(...)`
- transport failures
- external integration failures

This creates an inconsistency in failure semantics.

## Core Idea

Introduce an expression-level `try` operator:

```nrv
result = try tool("search", { q:event.value })
```

For supported operational failures, `try` converts execution failure into a deterministic envelope instead of terminating workflow execution.

## Explicit Non-Suppression Boundary

`try` does not suppress:

- parse errors
- compile/runtime structural errors
- invalid workflow semantics
- deterministic evaluation errors

`try` only converts supported operational execution failures into explicit envelopes.

## Semantics

### Success

```json
{
  "ok": true,
  "value": ...
}
```

### Failure

```json
{
  "ok": false,
  "error": {
    "type": "...",
    "message": "...",
    "output": "..."
  }
}
```

`error.output` is optional and is included when the failing operation has original text output to preserve.

The workflow author explicitly handles the result.

Example:

```nrv
search = try tool("search", { q:event.value })

if search.ok
  output text search.value
else
  output text "Search failed."
end
```

## Important Distinction

This is not exception handling.

No:

- stack unwinding
- hidden control transfer
- catch scopes
- implicit propagation
- runtime jumps

Instead:

- failure becomes explicit data
- control flow remains deterministic
- branching remains visible and graphable

## Why Expression-Level

Recommended form:

```nrv
result = try tool(...)
```

Not:

```nrv
try
  ...
catch
  ...
end
```

Reasons:

- preserves deterministic graph structure
- preserves explicit control flow
- keeps failure handling local
- avoids introducing a second hidden control-flow system

Nerveflow already has explicit control-flow primitives:

- `if`
- `emit`
- event routing
- contract envelopes

`try` composes with those semantics instead of replacing them.

## Supported Operations (Phase 1)

Phase 1 supports `try` for:

- `tool(...)`
- `script(...)`
- `operator(...)`
- `try_bind(...)`

Phase 1 also supports `try` for `agent(...)` and `model(...)` in contracted and uncontracted modes.

For `try agent(...)` and `try model(...)`, the following must hold:

- `on_contract_violation` is absent

`returns`, `decide` (agent), and `retry_on_contract_violation` are valid with `try`.

If any disallowed option is present, runtime raises `INVALID_CALL_CONFIG`.

## Agent And Model Compatibility Boundary

To preserve a single long-term failure envelope construct without conflicting with existing contract semantics, `try`-wrapped `agent` and `model` calls are limited to operational failure capture in Phase 1.

Operational failures that become envelope errors:

- transport/provider failures
- timeouts
- host adapter call failures
- other execution-time external call failures

Failures that remain hard runtime errors:

- invalid call configuration
- invalid argument shapes or types
- other programmer/runtime structural errors

`try`-wrapped contracted `agent` and `model` calls preserve existing contract semantics and retries. When retries are exhausted, contract failures become explicit `try` failure envelopes. Contract concerns still use existing explicit mechanisms:

- `returns` and `decide` validation
- `retry_on_contract_violation`
- `on_contract_violation` routing

## Relationship To Existing Contracts

This proposal extends an existing envelope pattern.

Current:

```nrv
result = try_bind(raw, contract)

if result.ok
  ...
end
```

Proposed:

```nrv
search = try tool(...)
reply = try agent(...)
```

In Phase 1, `try` around `agent` and `model` is valid for contracted and uncontracted calls, except when `on_contract_violation` is present.

## Compatibility Matrix

- `try` + `tool/script/operator`: valid
- `try` + `agent/model` (contracted or uncontracted): valid
- `try` + `agent/model` with `on_contract_violation`: invalid
- `try` + `agent/model` with `retry_on_contract_violation > 0`: valid

## Runtime Safety Direction

The goal is explicit operational boundedness.

A mature workflow should be able to model:

- model uncertainty
- tool failures
- transport failures
- validation failures
- degraded execution paths

through explicit deterministic structure.

Example:

```nrv
weather = try tool("weather", { city:event.value })

if weather.ok
  output text weather.value.summary
else
  emit("weather_unavailable", weather.error)
end
```

This keeps runtime behavior inspectable, recovery behavior explicit, and degradation paths deterministic.

## Relationship To Workflow Philosophy

This direction aligns with Nerveflow principles:

- deterministic workflow
- explicit control boundaries
- inspectable runtime behavior
- bounded cognition
- structured failure routing

Uncertainty should be modeled explicitly, not hidden implicitly.

## Potential Tooling Benefits

If `try` becomes standardized, Studio and tooling gain new capabilities.

### Static Warnings

Examples:

```text
Unsafe runtime call:
tool(...) result not wrapped in try
```

```text
Unhandled envelope:
result.value accessed without result.ok check
```

### Runtime Visualization

Graph view can represent:

```text
operation
   -> result envelope
   -> success/failure branch
```

### Reliability Analysis

Scenario tooling can measure:

- failure frequency
- retry recovery rates
- fallback routing behavior

across explicit operational boundaries.

## Comparison With Exceptions

Traditional exceptions:

- hidden propagation
- stack unwinding
- implicit jumps
- difficult graph representation

Nerveflow `try`:

- explicit envelope
- explicit branching
- deterministic routing
- graph-native semantics

## Mental Model

Without `try`:

```nrv
result = tool(...)
```

Failure aborts execution.

With `try`:

```nrv
result = try tool(...)
```

Failure becomes explicit runtime state.

The workflow author decides:

- retry
- fallback
- emit
- ignore
- degrade gracefully

Nothing happens implicitly.

## One-Line Summary

`try` converts operational runtime failures into explicit deterministic envelopes, including uncontracted `agent` and `model` calls in Phase 1, while preserving existing contract enforcement paths for contracted calls.
