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
- `agent(agentName, prompt?, instructions?, messages=?, format=?)`
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
