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
- `length(listOrStringOrObject)`
- `take(list, n)`
- `find_by(list,key,value)`
- `remove_by(list,key,value)`
- `dedupe_by(list,key)`
- `sort(list,key,desc=false)`
- `cut(list,key,op,value)`
- `exact_length(n, schema)`
- `file(path)`
- `input([prompt])`
- `from_json(text)`
- `to_json(value)`
- `emit(type, value)`

Language constructs (not regular function calls):

- `parallel([agent(...), model(...), ...])`

Try envelope expression:

- `try <call-expression>`

`parallel([...])` evaluates a group of independent `agent()` or `model()` calls and returns their results in input order. All children are evaluated under a shared context snapshot. If any child fails, the entire expression fails; if multiple fail, the error from the lowest input index is surfaced. `on_contract_violation` is not allowed inside parallel children. `parallel([...])` must be assigned to a variable.

`try <call-expression>` converts supported operational call failures into explicit envelope values:

- success: `{ ok: true, value: ... }`
- failure: `{ ok: false, error: { type, message, output? } }`

When the failing operation has original text output available, `error.output` preserves that source text.

Phase 1 supports `try` with:

- `tool(...)`
- `script(...)`
- `operator(...)`
- `try_bind(...)`
- `agent(...)`
- `model(...)`

For `try` with `agent(...)` or `model(...)`, the call must not use:

- `on_contract_violation`

`returns`, `decide` (agent only), and `retry_on_contract_violation` are supported with `try`.

Invalid combinations raise `INVALID_CALL_CONFIG`.

`try` does not suppress parse errors, compile/runtime structural errors, invalid workflow semantics, or deterministic evaluation errors.

See `docs/spec-parallel-group-evaluation.md` for full semantics.

Collection helper semantics:

- `length`: arrays -> item count, strings -> character count, objects -> top-level key count
- `take`: returns first `n` rows from a list; non-positive `n` returns `[]`
- `find_by`: returns first row where `row[key] == value`, else `null`
- `remove_by`: returns a new list excluding rows where `row[key] == value`
- `dedupe_by`: returns a new list where first occurrence of each `row[key]` is kept (stable order)
- `sort`: returns a new list sorted by `row[key]` ascending; `desc=true` reverses order; numeric values use numeric comparison, others use lexicographic order; stable within ties
- `cut`: returns the longest prefix where `row[key] op value` is true; supported operators are `>`, `>=`, `<`, `<=`; stops at the first failure, excludes the failing item, and preserves input order; intended for meaningfully ordered lists

Current key support for collection helpers is flat key names (no dotted key traversal).

Example:

```
relevant = cut(results, "similarity", ">=", 0.6)
```

Recognized integration calls:

- `tool(name, ...)`
- `agent(agentName, prompt?, instructions?, messages=?, format=?, returns=?, validate=?, retry_on_contract_violation=?, on_contract_violation=?)`
- `model(modelName, prompt?, instructions?, messages=?, format=?, returns=?, validate=?, retry_on_contract_violation=?, on_contract_violation=?)`

`model()` has the same signature and semantics as `agent()`, but takes a direct model identifier instead of an agent profile name. The model name is passed directly to the transport layer.

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
- `validate="strict"`: requires all declared fields and exact structural types with no repair; additional undeclared object fields are violations

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

## 5. Configuration Layer: Models, Transports, and Agents

Workflows can reference LLM models and agent profiles through a centralized three-layer configuration system. This allows you to:

- Define reusable transport configurations (endpoint, credentials) separately from model logic
- Define reusable model configurations (transport reference, model ID) once
- Define agent profiles with shared instructions and tools
- Keep script logic decoupled from infrastructure details

### Transports Registry

Define transport endpoints in `nextv.json#transports` or a separate `transports.json` file.
`transports.json` is environment-specific and should not be committed to version control.

```json
{
  "transports": {
    "ollama": {
      "provider": "ollama",
      "base_url": "http://localhost:11434"
    },
    "llama.cpp": {
      "provider": "llama.cpp",
      "endpoint": "http://localhost:8080"
    }
  }
}
```

Each transport entry requires a `provider` field (non-empty string). All other fields are passed through to the transport adapter as-is, enabling capability metadata:

```json
{
  "transports": {
    "ollama": {
      "provider": "ollama",
      "base_url": "http://localhost:11434",
      "vision": true,
      "context_length": 128000
    }
  }
}
```

Loading precedence: `nextv.json#transports` → `nextv.json#transportsConfig` (external file reference) → `transports.json` (auto-discovered in workspace root).

### Models Registry

Define models in `nextv.json#models` or a separate `models.json` file:

```json
{
  "models": {
    "local-llama": {
      "model": "llama3.2",
      "transport": "ollama"
    },
    "remote-gpt": {
      "model": "gpt-4-turbo",
      "transport": "openai"
    }
  }
}
```

The `transport` field must match an entry in the transports registry (or a builtin name: `ollama`, `llama.cpp`, `llama_cpp`, `openai`).

### Agent Profiles

Define agent profiles in `nextv.json#agents` or a separate `agents.json` file:

```json
{
  "agents": {
    "profiles": {
      "qa_bot": {
        "model": "local-llama",
        "instructions": "You are a QA expert. Respond concisely.",
        "tools": ["run_test", "check_coverage"]
      }
    }
  }
}
```

Agent profiles must not define `transport`; this is reserved for the models layer. Profiles must reference a model name that exists in the models registry.

### Resolution Chain

When you call `agent("qa_bot", ...)` in a script:

1. Runtime looks up "qa_bot" in `agents.profiles`
2. Profile specifies `model: "local-llama"`
3. Runtime looks up "local-llama" in `models.map`
4. Models entry specifies transport label (`ollama`) and model ID (`llama3.2`)
5. Runtime looks up "ollama" in `transports.map` — resolves endpoint config
6. Profile instructions and tools are merged with call-time arguments
7. Full resolved config (`model`, `transport`) is passed to the transport adapter

If the agent or model is not found in config, the runtime falls back to treating the name as a direct model identifier (for backward compatibility) or uses environment variables (`OLLAMA_MODEL`, `AGENT_TRANSPORT`).

Transport labels that appear in `models.map` but are absent from `transports.map` are flagged as `TRANSPORT_NOT_FOUND` at startup — this is always a fatal error regardless of `effectsPolicy`.

### Backward Compatibility

- Existing scripts using `agent("modelname", ...)` without configuration still work
- Direct `model("llama3.2", ...)` calls bypass configuration entirely
- Environment variables (`OLLAMA_MODEL`, `AGENT_TRANSPORT`) still apply as fallback

## Cardinality Constraints

`exact_length(n, schema)` enforces exact array cardinality on return contracts:

- `n` — numeric expression evaluated at agent call time
- `schema` — an array schema exemplar `[{ ... }]`

Requires the returned array to contain exactly `n` items. Items are validated against the schema. Unlike coerce mode for structural fields, cardinality mismatches fail in both strict and coerce modes — missing items cannot be fabricated.

Static example:

```
returns={
  classifications: exact_length(10, [{ id: "", level: "", topic: "" }])
}
```

Dynamic example (one output per input item):

```
items = take(batch.articles, 10)

result = agent(
  "classifier",
  to_json(items),
  returns={
    classifications: exact_length(
      length(items),
      [{ id: "", level: ["urgent", "high", "normal", "ignore"] }]
    )
  },
  retry_on_contract_violation=2
)
```

When a cardinality violation occurs with `retry_on_contract_violation`, the retry prompt includes specific feedback:

```
classifications requires exactly 10 items. You returned 9.
Return one entry for every input item. Do not skip or omit any items.
```

Rules:

- `n` must evaluate to a non-negative integer
- `schema` must be a non-empty array with one exemplar item
- violations fail in both strict and coerce mode
- nested enum constraints in the schema are still validated
- can be used at any depth in the return contract object

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

## 6. Events, Subscriptions, And Queueing

Signal model:

- `emit(type, value)` appends to a runtime queue
- handlers run after entrypoint execution (deferred drain phase)
- queue drains FIFO
- matching handlers run in deterministic registration/file order
- handler payload is available via `event.value`

External ingress model:

- `on external "type"` is auto-bound to matching host input event type
- manual bridge boilerplate is not required

## 7. Output Model

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

## 8. Includes

Include behavior:

- include paths resolve relative to current file directory when run from file context
- include cycles are rejected

## 9. Strict Mode

Strict mode is compile-time validation.

Current strict-mode forbidden calls:

- `input()`
- `from_json()`

Strict checks apply across nested expressions, not just top-level calls.

## 10. Host Boundary

Nerveflow runtime computes and emits events; host adapters provide side effects and integrations.

Host-owned responsibilities include:

- tool execution (`callTool`)
- agent/model invocation (`callAgent`)
- nested script execution (`callScript`)
- operator path resolution (`resolveOperatorPath`)
- input/event transport and persistence strategy

Agent metadata note:

- `agent()` still returns workflow values only; per-call provider metadata is a host observability payload surfaced in `nextv_execution.result.agentCalls`
- see [04-host-integration.md](04-host-integration.md#agent-call-metadata-contract-additive) for the additive metadata contract and example payloads

## 11. Contract Notes

This reference is intentionally implementation-aligned.

For canonical behavior details, align this document with:

- [02-getting-started.md](02-getting-started.md)
- [04-host-integration.md](04-host-integration.md)
- runtime tests under [../tests/](../tests/) for executable semantics
