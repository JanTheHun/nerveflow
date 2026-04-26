# Agent Language Reference

This reference is optimized for coding agents generating `.nrv` scripts.

Scope: deterministic workflow behavior, bounded model calls, and explicit event/effect semantics.

## 1. Core Statements

Supported:

- `include "path.nrv"`
- `x = expr`
- `x += expr`
- `state.path = expr`
- `output <channel> expr`
- `print expr`
- `on "event" ... end`
- `on external "event" ... end`
- `if / else if / else / end`
- `for i in start..end ... end`
- `stop`
- `return expr`

Restrictions:

- `on` blocks are top-level only
- standalone non-call expressions are invalid
- removed syntax such as `loop ... end` is invalid

## 2. Values And Expressions

Kinds:

- string, number, boolean, null
- object and array literals
- variable paths (`x`, `state.foo`, `event.value`)
- interpolation (`"hello ${name}"`)
- arithmetic and comparisons
- logical operators (`&&`, `||`, aliases `&`, `|`)
- function calls

Important boundary:

- object/array values do not implicitly coerce to text
- use `to_json(...)` when converting structured values to text

## 3. Integration Calls

`agent(...)` signature:

```text
agent(agentName, prompt?, instructions?, messages=?, format=?, returns=?, validate=?, retry_on_contract_violation=?, on_contract_violation=?)
```

`tool(...)`, `script(...)`, and `operator(...)` are host-backed integration calls.

## 4. Returns Contract Semantics

`returns` accepts a JSON-like object/array contract template.

Example:

```nrv
returns={
  intent:["chat","search","other"],
  confidence:0,
  meta:{ source:"" }
}
```

Validation modes:

- `validate="coerce"` (default): repairs missing declared structure only
- `validate="strict"`: requires full exact structural conformance

Enum semantics:

- two or more string literals represent an enum-constrained scalar string
- exact literal match required
- unknown enum values fail in both strict and coerce
- missing enum fields fail in both strict and coerce
- wildcard enum values such as `"*"` are invalid

## 5. Retry And Violation Routing

Retry control:

- `retry_on_contract_violation=<non-negative integer>`
- applies only to contract validation failures

Violation routing:

- `on_contract_violation=emit("event", violation)`
- executes only when validation still fails after retries
- `violation` includes `type`, `field`, `expected`, `actual`

## 6. Event Model

- `emit(type, value)` queues an event
- queue drains FIFO
- handlers execute deterministically in registration order
- `on external` is host ingress for external event types

## 7. Output Model

Built-in channels include `text`, `json`, `console`, `voice`, `visual`, and `interaction`.

Agent guidance:

- use `output json` for structured payloads
- keep outputs explicit at route boundaries

## 8. Determinism Rules For Generated Scripts

Agents should ensure:

- each effectful path is controlled by explicit branch logic
- model outputs are bounded before driving routing/effects
- violation and fallback behavior is explicit
- no hidden control flow in prompt text

## 9. Minimal Canonical Example

```nrv
on external "user_message"
  decision = agent(
    "router",
    event.value,
    returns={ intent:["chat","search","other"] },
    retry_on_contract_violation=1,
    on_contract_violation=emit("contract_violation", violation)
  )

  if decision.intent == "chat"
    emit("chat_flow", event.value)
  else if decision.intent == "search"
    emit("search_flow", event.value)
  else
    output text "Do you want chat help or search help?"
  end
end

on "contract_violation"
  output text "I could not parse that safely. Please rephrase."
end
```
