# Late Contract Binding â€” Language Integration

**Status:** final v1

---

## Purpose

Elevate late contract binding from a usage pattern to a **first-class language semantic**.

This enables:

* explicit validation as part of workflow control flow
* provenance tracking of bounded vs unbounded values
* improved graph representation and tooling
* future extensibility without breaking syntax

This spec builds on:

* structured return contracts (`returns`)
* `validate="none"`
* `try_bind(value, contract)`

---

## Core Idea

Late binding introduces a **two-phase model interaction**:

1. **Generation phase** (untrusted output)
2. **Binding phase** (validated structure)

```nrv
raw = agent(..., validate="none")
result = try_bind(raw, contract)
```

These are not just function calls.

They represent **distinct semantic phases in the execution model**.

---

## Semantic Model

### 1. Unbound Value

A value is considered **unbound** when it originates from:

```nrv
agent(..., validate="none")
model(..., validate="none")
```

**Definition**

An unbound value is model-produced data that has not been validated against a contract.

**Properties**

* may be structured (parsed JSON) or raw string
* must not be assumed to satisfy any schema
* is considered **unbounded origin** in provenance analysis

---

### 2. Binding Result and Bound Value

`try_bind(value, contract)` returns a **binding result** â€” an envelope:

```json
{ "ok": true,  "value": "<validated>" }
{ "ok": false, "error": { ... } }
```

A **bound value** is `result.value` from a successful `try_bind` call, not the envelope itself.

On success:

```json
{
  "ok": true,
  "value": "<validated value>"
}
```

On failure â€” JSON parse error:

```json
{
  "ok": false,
  "error": {
    "type": "json_parse_error",
    "message": "...",
    "raw": "..."
  }
}
```

On failure â€” contract violation:

```json
{
  "ok": false,
  "error": {
    "type": "contract_violation",
    "message": "...",
    "field": "...",
    "expected": "...",
    "actual": "..."
  }
}
```

Note: `raw` is present only for `json_parse_error` (the original string is preserved for diagnostics). It is absent for `contract_violation` (the input was already parsed).

**Bound value properties**

* guaranteed to conform to contract structure
* safe for deterministic routing and effect decisions
* considered **bounded origin** in provenance analysis

---

### 3. Binding Operation

`try_bind(value, contract)` is a **binding operation**, not a generic function.

**Semantic steps**

1. normalize input

   * if value is a string â†’ attempt JSON parse
   * if parse fails â†’ return `json_parse_error`
   * if value is already structured â†’ use as-is

2. validate against contract (strict)

3. return `{ ok, value }` on success or `{ ok, error }` on failure

---

## Relationship To Existing Modes

Late binding introduces a **new binding protocol**, not just a validation mode.

### Distinction

| Concept              | Meaning                                    |
| -------------------- | ------------------------------------------ |
| Validation guarantee | whether output conforms to contract        |
| Binding protocol     | whether result is wrapped in `{ ok, ... }` |

### Comparison

| Mode              | Validation        | Binding Protocol | Result Shape                       |
| ----------------- | ----------------- | ---------------- | ---------------------------------- |
| `coerce`          | yes (with repair) | implicit         | plain value                        |
| `strict`          | yes (no repair)   | implicit         | plain value                        |
| `none + try_bind` | explicit          | explicit         | `{ ok, value }` or `{ ok, error }` |

Important:

* `strict` / `coerce` return validated values directly
* `try_bind` returns a **binding envelope**

These are not interchangeable.

---

## `validate="none"` Semantics

### With `returns`

```nrv
agent(..., returns=..., validate="none")
```

* `returns` used for generation guidance only
* no validation, repair, or retry
* output is unbound

---

### Without `returns`

```nrv
agent(..., validate="none")
```

* valid, but has no effect on validation (no contract exists)
* output is always considered **unbound**

---

### Without `try_bind`

```nrv
raw = agent(..., validate="none")
output text raw
```

This is an **intentional escape hatch**:

* bypasses contract enforcement
* allows direct use of model output
* shifts full responsibility to workflow author

---

### Invalid Argument Combinations

The following combinations are invalid and must be rejected at runtime:

```nrv
agent(..., validate="none", retry_on_contract_violation=1)
agent(..., validate="none", on_contract_violation=emit(...))

model(..., validate="none", retry_on_contract_violation=1)
model(..., validate="none", on_contract_violation=emit(...))
```

Error code: `INVALID_CALL_CONFIG`

Rationale: `retry_on_contract_violation` and `on_contract_violation` depend on runtime contract enforcement. With `validate="none"`, enforcement is disabled; these arguments are meaningless and their presence indicates a programming error.

---

## IR Integration

### v1 Approach (Recommended)

Extend existing IR instead of introducing new opcodes.

#### Agent call annotation

```json
{
  "type": "agent_call",
  "validate": "none",
  "unbound": true
}
```

#### Binding operation

```json
{
  "type": "bind_contract",
  "input": "...",
  "contract": "..."
}
```

---

### Optional Future (Full Separation)

```
AGENT_CALL_UNBOUND
BIND_CONTRACT
```

This is a possible future refinement but not required for v1.

---

## Provenance Semantics

### Key Principle

Provenance applies to **data origins and access paths**, not container objects.

The binding result object itself (`result`) is a deterministic runtime structure and does not carry mixed provenance. Provenance is determined by which fields are accessed and how they are used in control flow.

---

### Classification

| Access Pattern                    | Provenance |
| --------------------------------- | ---------- |
| `raw.*`                           | unbounded  |
| `result.value.*` (when `ok=true`) | bounded    |
| expressions combining both        | mixed      |

---

### Control Flow Rules

#### 1. Safe Control (bounded)

```nrv
if result.ok
  if result.value.intent == "search"
```

Control depends only on bounded values.

---

#### 2. Unsafe Control (unbounded)

```nrv
if raw.intent == "search"
```

Control depends on an unbound value.

---

#### 3. Mixed Control

```nrv
if result.ok && raw.intent == "search"
```

Control depends on both bounded and unbounded inputs.

---

### Tooling Guidance

* bounded control â†’ safe
* unbounded control â†’ tooling SHOULD warn
* mixed control â†’ tooling MAY warn

This is advisory only in v1.

---

## Graph Model

Binding introduces an explicit graph node:

```
[AGENT_CALL] â†’ [BIND_CONTRACT] â†’ [IF]
```

**Benefits**

* clear separation of generation vs validation
* explicit trust boundary
* improved debugging and observability

---

## Correctness Rules

### Rule 1 — Binding is required for safe routing

Control flow **SHOULD NOT** depend on unbound values.

---

### Rule 2 — Binding result must be checked

Users **SHOULD** check `result.ok` before using `result.value`.

---

### Rule 4 — Bound value is undefined when binding failed

Accessing `result.value` when `result.ok == false` is **undefined behavior** and MUST be guarded.

Rationale: `result.value` is absent from the failure envelope. Accessing it unconditionally is a programming error that static analysis and future strict modes SHOULD detect.

---

### Rule 3 — No implicit binding

The runtime **MUST NOT**:

* auto-validate
* auto-coerce
* auto-retry

when `validate="none"` is used.

---

## Example

```nrv
on external "user_message"

  raw = agent(
    "classifier",
    event.value,
    returns={
      intent: ["chat", "search", "other"],
      confidence: 0
    },
    validate="none"
  )

  result = try_bind(raw, {
    intent: ["chat", "search", "other"],
    confidence: 0
  })

  if result.ok
    emit("route", result.value)
  else
    emit("contract_violation", result.error)
  end

end
```

---

## Backward Compatibility

* existing `returns + validate` behavior remains unchanged
* late binding is opt-in
* no breaking changes to existing scripts

---

## Future Extensions (Non-Goals for v1)

### 1. Alternate binding modes

Possible future:

```nrv
try_bind(value, contract, mode="coerce")
```

### 2. Binding syntax sugar

```nrv
result = bind raw to contract
```

### 3. Static analysis / linting

* detect unsafe control from unbound values
* enforce binding before effectful actions

---

## Design Principles

### Explicit over implicit

Validation is visible in workflow logic.

### Separation of phases

* generation is probabilistic
* binding is deterministic

### Deterministic control

Only bound values should drive routing and effects.

---

## Mental Model

Before:

```nrv
agent(...) → validated or error
```

After:

```nrv
raw = agent(..., validate="none")
result = try_bind(raw, contract)

if result.ok
  ...
else
  ...
end
```

---

## One-Line Summary

Late contract binding makes validation an explicit, programmable step where:

> model output is untrusted by default, and binding defines safe control boundaries.

---

## Implementation Notes

This section captures implementation-level details that complement the canonical spec above.

### Non-contract failure clarification

`validate="none"` disables contract enforcement only.

The call may still fail due to:

- transport/provider errors
- timeouts
- host adapter failures
- other runtime errors unrelated to contract validation

These failures propagate normally regardless of `validate`.

### Parsing behavior when `returns` is present

When `validate="none"` and `returns` is present, the runtime MUST still attempt JSON parsing.

Outcomes:

- valid JSON → return parsed JSON value
- invalid JSON → return raw text string

Notes:

- all valid JSON values are allowed: object, array, string, number, boolean, null
- no partial parsing is allowed
- the result is always either a fully parsed JSON value or the original raw string
- structural validation is deferred to `try_bind`

### `try_bind` step-by-step

`try_bind(value, contract)` must perform three steps.

**Step 1 — Input normalization**

- if `value` is a string, attempt JSON parse
- if parse fails, return `json_parse_error`
- if `value` is not a string, use it as-is with no parsing

**Step 2 — Validation**

- validate against `contract` using the same rules as `returns`
- validation is strict-only: no coercion, no repair

**Step 3 — Result**

- valid → `{ ok: true, value }`
- invalid → `{ ok: false, error: contract_violation }`

### Invalid contract handling

If `contract` is malformed or not an object/array:

- this is a programmer error, not model-output uncertainty
- `try_bind` MUST NOT convert it into `{ ok: false, error }`
- it must throw or raise a normal runtime error

Rationale: separates programmer errors from model-output uncertainty.
