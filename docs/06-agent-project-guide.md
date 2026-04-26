# Agent Project Guide

This guide is for coding agents that generate Nerveflow projects.

Primary goal: produce deterministic workflows around probabilistic model calls.

Design center:

- Deterministic Workflow is the execution spine.
- Decision Contracts are the cognition boundary.
- Event and Effect Surface is the world interface.

## 1. Minimum Project Shape

Recommended starting files:

- `workflow.nrv`
- `nextv.json`
- `contracts/` (JSON contracts)
- `prompts/` (domain prompt files)
- `README.md` with run instructions

Optional but recommended:

- test script or smoke workflow
- host adapter config

## 2. Build Order For Agents

Use this order to avoid fragile flows:

1. Declare external events first.
2. Define deterministic routing and state updates.
3. Add outputs/effects for each route.
4. Add `agent(...)` calls with `returns` contracts.
5. Add `retry_on_contract_violation` where recovery is useful.
6. Add `on_contract_violation=emit(...)` for explicit failure routing.
7. Add final fallback outputs for unresolved paths.

## 3. Contract-First Pattern

Always write the contract before refining prompt text.

Example:

```nrv
decision = agent(
  "router",
  event.value,
  file("prompts/router.md"),
  returns=from_json(file("contracts/router.contract.json")),
  validate="strict",
  retry_on_contract_violation=1,
  on_contract_violation=emit("contract_violation", violation)
)
```

Rules:

- Keep contracts small and explicit.
- Prefer enum-bounded decision fields.
- Include `"other"` only when fallback behavior exists.
- Do not rely on prompts to replace missing contract boundaries.

## 4. Deterministic Routing Pattern

```nrv
on external "user_message"
  decision = agent(
    "router",
    event.value,
    returns={ intent:["chat","search","other"] },
    on_contract_violation=emit("contract_violation", violation)
  )

  if decision.intent == "chat"
    emit("chat_flow", event.value)
  else if decision.intent == "search"
    emit("search_flow", event.value)
  else
    output text "I can help with chat or search. Which one?"
  end
end
```

## 5. Failure Routing Pattern

```nrv
on "contract_violation"
  output text "I could not safely interpret that request. Please rephrase."
end
```

When available, use `event.value.field`, `event.value.expected`, and `event.value.actual` for user-facing repair prompts.

## 6. Effect Surface Rules

- Use explicit `output <channel> <value>` statements.
- Prefer `output json` for structured payloads.
- Ensure each route has a visible effect or emitted event.
- Avoid hidden side effects in prompt text.

## 7. Prompt Authoring Rules For Agents

Prompt files should be domain-specific and brief.

Do:

- describe intent mapping and domain cues
- mention how to use fallback enum values when present

Do not:

- restate runtime validation mechanics
- include generic JSON formatting boilerplate already enforced by runtime
- duplicate contract schema text manually

## 8. Agent Output Quality Bar

A generated project is acceptable when:

- every `agent(...)` decision that impacts routing has a `returns` contract
- decision enums are bounded and realistic
- fallback paths exist for `"other"` and violation events
- deterministic `if/else` routing controls all effectful branches
- no effectful action depends on unconstrained free-text decisions

## 9. Common Anti-Patterns

Avoid:

- unconstrained `agent(...)` output driving tools directly
- missing fallback route for `"other"`
- prompt-only safety without contract enforcement
- emitting effects before validation and routing

## 10. Generation Checklist (Short)

Before finishing, verify:

- contract files exist and are referenced with `from_json(file(...))`
- route branches are exhaustive
- violation handler exists where reliability matters
- outputs are declared and inspectable
- workflow remains deterministic under retries and failures
