# Language Reference (v1)

This document defines the current user-facing language surface for Nerveflow scripts (`.nrv` preferred, `.wfs` compatible).

Execution model summary:

- `source -> AST -> IR -> execute`
- deterministic control flow in runtime core
- host provides integrations (`tool`, `agent`, `script`, `operator`, `input` behavior)

## 1. Statements

Supported statements:

- include: `include "relative/path.nrv"`
- assignment: `x = expr`
- append assignment: `x += expr`
- state assignment: `state.path = expr`
- output: `output <channel> expr`
- print alias: `print expr` (alias of `output text expr`)
- event subscription: `on "event_type" ... end`
- external event subscription: `on external "event_type" ... end`
- conditionals: `if ... else if ... else ... end`
- bounded iteration: `for i in start..end ... end`
- stop: `stop`
- return: `return expr`
- expression statement: function call only

Invalid statement rules:

- standalone non-call expressions are invalid
- `on` blocks are top-level only (cannot be nested)
- `loop ... end` is removed in v1 (`LOOP_REMOVED`)

## 2. Expressions And Values

Supported expression/value kinds:

- string, number, boolean, null literals
- object and array literals
- path access (`x`, `state.foo`, `event.value`, `response.intent`)
- string interpolation (`"hello ${name}"`)
- arithmetic operators: `+`, `-`, `*`, `/`
- comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
- logical operators: `&&`, `||` (aliases: `&`, `|`)
- function calls

Arithmetic rules:

- `+` supports numeric addition, array concatenation, and text concatenation
- `-`, `*`, and `/` require finite numeric operands
- `/` raises `DIVISION_BY_ZERO` when the right-hand operand is `0`

Operator precedence:

- parentheses
- multiplicative: `*`, `/`
- additive: `+`, `-`
- comparisons: `==`, `!=`, `<`, `>`, `<=`, `>=`
- logical operators: `&&`, `||` (aliases: `&`, `|`)

Important coercion rule:

- structured values (object/array) do not implicitly coerce to text in text boundaries
- use `to_json(...)` for explicit serialization

## 3. Assignment And Scope

Assignment targets:

- local variable names (`x`, `result`, `messages`)
- `state.<path>`

Scope/boundary rules:

- `event` is read-only and cannot be assigned
- `state.*` persists across executions when host persists state
- locals are execution-scoped

## 4. Calls

Core built-ins:

- `concat(...)`
- `file(path)`
- `input([prompt])`
- `from_json(text)`
- `to_json(value)`
- `emit(type, value)`

Recognized integration calls:

- `tool(name, ...)`
- `agent(agentName, prompt?, instructions?, messages=?, format=?, returns=?, validate=?, retry_on_contract_violation=?, on_contract_violation=?)`

`messages` entries have the shape `{ role, content, images? }`. `role` and `content` are required. `images` is an optional array of base64-encoded image strings; empty strings are filtered and the field is omitted when no valid entries remain. Example:

```
history = [
  { role: "user", content: "what is in this image?", images: [b64_string] },
  { role: "assistant", content: "a cat" },
]
reply = agent("visual", messages=history)
```

`returns` accepts a JSON-like object or array contract template for structured agent output. When present, NerveFlow treats the call as JSON output mode and validates the parsed output against the contract.

Contracts can also be loaded from JSON files with standard value expressions:

```
returns=from_json(file("contracts/triage.json"))
```

`file(...)` yields text. Use `from_json(...)` when loading JSON contracts. `returns=file("...")` by itself is invalid unless future runtime auto-parse support is added.

`validate` controls validation behavior when `returns` is present:

- `validate="coerce"` (default): fills missing declared structure from the contract recursively
- `validate="strict"`: requires all declared fields and exact structural types with no repair

`retry_on_contract_violation` controls retry behavior when `returns` is present and validation fails:

- integer ≥ 0
- default: 0 (no retries)

When the model output violates a return contract, runtime may issue up to `N` additional agent calls with corrective guidance that includes the specific violation feedback.

Retries do not relax or bypass validation—each attempt is fully revalidated against the same contract.

Effectiveness note: retries are typically most effective for malformed JSON and structural violations. Semantic enum violations depend on model behavior and prompt quality.

`on_contract_violation` declares a handler for exhausted contract violations:

- must be an `emit(eventType, value)` expression
- executes only if validation fails and retries (if configured) are exhausted
- provides implicit `violation` object with `type`, `field`, `expected`, `actual` properties

Example:

```
light = agent(
  "intent",
  event.value,
  returns=from_json(file("lighting.contract.json")),
  on_contract_violation=emit("contract_violation", violation)
)

on "contract_violation"
  output text "Could not interpret that. The field was: ${event.value.field}"
end
```

If no handler is declared and validation fails, `AGENT_RETURN_CONTRACT_VIOLATION` is raised normally.

Enum-constrained scalar fields are supported with string-literal arrays:

```
returns={
  area: ["kitchen", "garage", "other"]
}
```

Rules:

- two or more string literals means enum-constrained string scalar
- exact literal match is required
- unknown enum values fail validation in both strict and coerce
- missing enum fields fail validation in both strict and coerce
- wildcard/pattern entries (for example `"*"`) are not supported
- when an enum includes `"other"`, hosts may inject fallback prompting that uses `"other"` when no listed value fits
- `"other"` has no special validation semantics; it remains an ordinary enum member

Example:

```
triage = agent(
  "classifier",
  event.value,
  returns={
    intent: "",
    confidence: 0,
    meta: {
      source: ""
    }
  },
  validate="strict"
)
```

Retry example:

```
light = agent(
  "intent",
  event.value,
  returns=from_json(file("lighting.contract.json")),
  retry_on_contract_violation=1
)
```
- `script(path, ...)`
- `operator(id, input?)`

Tool policy behavior:

- tool permissions are host-enforced, not DSL-enforced
- when workspace tool policy is configured, alias resolution happens before allow-list checks
- denied tools raise host policy errors; allowed but unimplemented tools raise host unavailable errors

IR lowering note:

- `tool(...) -> tool_call`
- `agent(...) -> agent_call`
- `script(...) -> script_call`
- `operator(...) -> operator_call`
- `emit(...)` currently lowers through generic call handling and queues a runtime signal

## 5. Events, Subscriptions, And Queueing

Signal model:

- `emit(type, value)` appends to a runtime queue
- handlers run after entrypoint execution (deferred drain phase)
- queue drains FIFO
- matching handlers run in deterministic registration/file order
- handler payload is available via `event.value`

External ingress model:

- `on external "type"` is auto-bound to matching host input event type
- manual bridge boilerplate is not required

## 6. Output Model

Built-in output channels:

- `text`
- `console`
- `voice`
- `visual`
- `json`
- `interaction` (supported for compatibility)

Declared output channels:

- workspaces may declare additional channels in `nextv.json#effects`
- declared channels are emitted through the same `output` statement
- if a declared channel omits `format`, runtime defaults emitted formatting to `json`

Examples:

- `output text "hello"`
- `output heartbeat "tick"` (when `heartbeat` is declared in `nextv.json#effects`)

Recommendations:

- prefer `output json ...` for new structured output flows
- use `interaction` only when host compatibility requires it

## 7. Includes

Include behavior:

- include paths resolve relative to current file directory when run from file context
- include cycles are rejected

## 8. Strict Mode

Strict mode is compile-time validation.

Current strict-mode forbidden calls:

- `input()`
- `from_json()`

Strict checks apply across nested expressions, not just top-level calls.

## 9. Host Boundary

Nerveflow runtime computes and emits events; host adapters provide side effects and integrations.

Host-owned responsibilities include:

- tool execution (`callTool`)
- agent/model invocation (`callAgent`)
- nested script execution (`callScript`)
- operator path resolution (`resolveOperatorPath`)
- input/event transport and persistence strategy

## 10. Contract Notes

This reference is intentionally implementation-aligned.

For canonical behavior details, align this document with:

- [02-getting-started.md](02-getting-started.md)
- [04-host-integration.md](04-host-integration.md)
- runtime tests under [../tests/](../tests/) for executable semantics
