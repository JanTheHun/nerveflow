# Canonical Snippets

Validated patterns for coding agents generating Nerveflow projects.

## Recommended pattern order

1. Classify -> Route -> Act
2. Bounded Tool Routing
3. Fallback-driven routing (other)
4. Contract violation handling
5. Structured output channel usage
6. Externalized contract and prompt files

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

## 2. Bounded tool routing

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

## 3. Contract violation handler

```nrv
on "contract_violation"
	output text "I could not safely interpret that request."
	output text "Field: ${event.value.field}"
	output text "Expected: ${event.value.expected}"
end
```

## 4. Structured output channel

```nrv
on "search_flow"
	result = { mode:"search", query:event.value, source:"user_message" }
	output json result
end
```

## 5. Guarded call with externalized contract

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

## Source alignment

For the full expanded snippet set and additional anti-pattern examples, use:
- ../09-agent-canonical-snippets.md
