# Nerveflow Vision

A nervous system for probabilistic software.

Nerveflow is built on three reinforcing primitives:

1. Deterministic Workflow: the execution spine
2. Decision Contracts: the cognition boundary
3. Event and Effect Surface: the world interface

Together they create bounded autonomy: model flexibility inside explicit control.

---

## What Environment-Aware Means

In Nerveflow, environment-aware means:

1. Sense context through declared external events
2. Make bounded decisions through contracts
3. Act through declared effects

The runtime does not hide this loop. It makes it explicit and inspectable.

---

## 1. Deterministic Workflow

A compact workflow language defines exact control flow.

```wfs
on external "user_message"
  result = agent("classifier", event.value)

  if result.intent == "chat"
    emit("chat_flow", event.value)
  else
    emit("search_flow", event.value)
  end
end
```

Deterministic Workflow defines:

- how workflows run
- how decisions are routed
- how state evolves
- how effects are emitted

Principle: deterministic structure governs execution.

---

## 2. Decision Contracts

Model calls are not opaque blobs. They are bounded decision points.

```wfs
light = agent(
  "intent",
  event.value,
  returns={
    area:["garage","front_lawn","other"],
    action:["ON","OFF","dim","other"]
  },
  retry_on_contract_violation=2,
  on_contract_violation=emit("contract_violation", violation)
)
```

A decision contract can define:

- expected structure
- bounded decision spaces (for example enums)
- validation mode
- bounded recovery attempts
- explicit failure routing

Principle: put boundaries around model calls.

Freedom inside bounds.

---

## 3. Event and Effect Surface

Workflows touch the world through declared interfaces.

Inputs:

```wfs
external "motion_sensor"
external "user_message"
```

Effects:

```wfs
output switch light
output text "What light?"
```

This is not generic IO. It is the inspectable world interface of the system.

Principle: inputs and effects should be declared, not hidden.

---

## One System, Three Legs

Deterministic Workflow controls execution.
Decision Contracts bound probabilistic decisions.
Event and Effect Surface connects the system to the world.

```text
Deterministic Workflow
        ^
        |
Decision Contracts --- Event and Effect Surface
```

Each leg reinforces the others:

- deterministic routing is stronger when decisions are bounded
- contracts matter because effects touch real systems
- effects are safer because workflow and decision boundaries are explicit

---

## Before and After: Why This Is Different

Without boundaries (common pattern):

```wfs
on external "user_message"
  result = agent("assistant", event.value)
  tool(result.tool_name, result.args)
end
```

Risks:

- unconstrained decision space
- hidden retries and failure behavior
- weak auditability when side effects occur

With Nerveflow boundaries:

```wfs
on external "user_message"
  decision = agent(
    "router",
    event.value,
    returns={tool:["search","calendar","other"], query:""},
    retry_on_contract_violation=1,
    on_contract_violation=emit("contract_violation", violation)
  )

  if decision.tool == "search"
    output text tool("search", {q: decision.query})
  else if decision.tool == "calendar"
    output text tool("calendar", {q: decision.query})
  else
    output text "I can search or check calendar. Which one do you want?"
  end
end
```

Outcome:

- bounded choices
- explicit failure path
- deterministic effect routing

---

## Guarantees by Tier

### Compile-Time Guarantees

- workflow syntax and structure validation
- event topology analysis and graph warnings
- contract schema shape checks

### Runtime Guarantees

- deterministic execution order
- contract validation on each model return
- bounded retries when configured
- violation payload routing when configured

### Operational Guarantees

- explicit event and effect traces
- inspectable state transitions
- policy-aware effect dispatch hooks

---

## Failure Model Is First-Class

Contract violations are treated as structured runtime events, not hidden prompt failures.

When configured, violations flow through control logic:

```wfs
on "contract_violation"
  output text "I did not understand that safely. Please rephrase."
end
```

Violation payloads can include:

- type
- field
- expected
- actual

This enables deterministic recovery paths instead of implicit agent loops.

---

## Minimal Surface, Hidden Depth

A tiny declaration:

```wfs
returns={ action:["ON","OFF","other"] }
```

can imply:

- prompt shaping guidance
- contract validation
- bounded retries
- drift rejection
- routed failure handling

Small surface. Hidden depth. Intentional.

---

## Boundaries and Non-Goals

What contracts help with:

- output shape and bounded choices
- predictable fallback behavior
- safer integration points

What contracts do not guarantee:

- factual correctness of model claims
- domain truth without verification
- business correctness unless rules are encoded in workflow

This keeps claims precise and trustable.

---

## Studio Implication

These primitives are small enough to be node-sized and graph-native.

Workflow node:

```wfs
if light.area != "other"
```

Decision contract node:

```wfs
returns={
  area:[...]
}
```

Effect node:

```wfs
output switch light
```

Small snippets. Composable graph. Inspectable nervous system.

Studio becomes a direct expression of runtime philosophy.

---

## Why This Matters

Many systems add autonomy to cope with uncertainty.
Nerveflow adds explicit structure to govern uncertainty.

Not intelligence without boundaries.
Bounded intelligence inside explicit control.

---

## Core Belief

Deterministic structure can govern probabilistic intelligence.

If this core is right, the ecosystem can scale around it.
If this core is wrong, feature volume will not save it.

---

## One Sentence

Nerveflow is a nervous system for probabilistic software:

- deterministic workflow as the spine
- decision contracts as cognitive boundaries
- event and effect surfaces as the system interface to the world
