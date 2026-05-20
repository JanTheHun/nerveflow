# Workflow Generation Rules

Informational rules for generating Nerveflow workflows.

## 1. Deterministic workflow controls execution

Routing should remain explicit and inspectable using workflow structure.
Do not hide control flow in prompt text.

## 2. Probabilistic decisions are bounded

Routing-critical model calls should use explicit contract boundaries such as:
- returns
- decide
- try_bind

Avoid unconstrained free-text routing.

## 3. Effects are explicit

User-visible behavior should flow through declared effects:
- output
- emit

Do not rely on hidden prompt-side effects.

## 4. Use documented language features

Use supported, documented syntax and behavior.
Do not invent undocumented syntax or runtime semantics.

Reference:
- agent-language-reference.md
- ../guide/03-language-reference.md

## 5. Include fallback behavior

Generated workflows should include explicit handling for:
- fallback/other outcomes where applicable
- contract violations where reliability matters
- deterministic failure visibility

## 6. Respect layer boundaries

Workflow/project generation consumes platform capabilities.
Runtime or language-semantic changes belong to platform work.

Related:
- ../platform/platform-agent-guide.md

## Generation expectations

Generated workflows should:
- include fallback handling
- use explicit routing branches
- keep outputs inspectable
- remain deterministic under retries/failures
- preserve visible failure behavior

## Compact example

```nrv
on external "user_message"
	decision = agent(
		"classifier",
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
