# Agent Canonical Snippets

Validated patterns for coding agents to reuse when generating Nerveflow projects.

## 1. Classify -> Route -> Act

```nrv
on external "user_message"
  decision = agent(
    "classifier",
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

## 2. Bounded Tool Routing

```nrv
on external "tool_request"
  plan = agent(
    "tool_router",
    event.value,
    returns={ tool:["calendar","search","other"], query:"" },
    retry_on_contract_violation=1,
    on_contract_violation=emit("contract_violation", violation)
  )

  if plan.tool == "calendar"
    output text tool("calendar", { q: plan.query })
  else if plan.tool == "search"
    output text tool("search", { q: plan.query })
  else
    output text "I can use calendar or search. Which one should I use?"
  end
end
```

## 3. Light Control With "other" Fallback

```nrv
on external "light_instruction"
  light = agent(
    "intent",
    event.value,
    returns={
      area:["garage","front_lawn","living_room","other"],
      action:["ON","OFF","dim","other"]
    },
    retry_on_contract_violation=2,
    on_contract_violation=emit("contract_violation", violation)
  )

  if light.area != "other" & light.action != "other"
    output switch light
  else if light.area == "other" & light.action == "other"
    output text "Do what with what?"
  else if light.area == "other"
    output text "Which light?"
  else
    output text "Do what with ${light.area}?"
  end
end
```

## 4. Contract Violation Handler

```nrv
on "contract_violation"
  output text "I could not safely interpret that request."
  output text "Field: ${event.value.field}"
  output text "Expected: ${event.value.expected}"
end
```

## 5. Structured Output Channel

```nrv
on "search_flow"
  result = { mode:"search", query:event.value, source:"user_message" }
  output json result
end
```

## 6. Guarded Agent Call With External Contract File

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

## 7. Prompt File Template (Domain-Only)

```text
Classify the user request into one of the contract enum intents.
Use only values present in the injected contract.
If no listed value fits, use the declared fallback enum value when available.
```

## 8. Anti-Snippet: Do Not Generate

```nrv
on external "user_message"
  raw = agent("assistant", event.value)
  tool(raw.tool_name, raw.args)
end
```

Why this is unsafe:

- unconstrained tool routing
- no decision contract
- no deterministic fallback behavior
