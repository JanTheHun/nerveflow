# Project Generator Guide

This guide is for agents generating Nerveflow applications and workflows.

Focus:
- deterministic routing structure
- bounded decision contracts
- explicit outputs and events
- visible fallback and failure handling

Shared philosophy:

> Deterministic structure governs probabilistic intelligence.

Design center:
- Deterministic Workflow is the execution spine.
- Decision Contracts are the cognition boundary.
- Event and Effect Surface is the world interface.

## Read in this order

1. workflow-generation-rules.md
2. agent-language-reference.md
3. workflow-checklists.md
4. canonical-snippets.md

## Canonical references in this repo

- workflow-generation-rules.md
- agent-language-reference.md
- workflow-checklists.md
- canonical-snippets.md
- ../guide/05-platform-vision.md

## Informational scope

Project-generation agents create and modify workflow projects, including:
- .nrv workflows
- contracts and prompt files
- routing and output/event patterns
- workspace configuration used by generated workflows

Project-generation agents consume platform semantics; they do not define runtime semantics.

## Minimum project shape

Recommended starting files:
- workflow.nrv
- nextv.json
- contracts/ (JSON contracts)
- prompts/ (domain prompt files)
- README.md with run instructions

Optional but recommended:
- test script or smoke workflow
- host adapter config

## Configuration map

When workflows call agent(...), define reusable configuration in nextv.json.

Common sections:
- transports: endpoint/provider registry
- models: model-to-transport bindings
- agents.profiles: reusable profile names used by workflow calls

Resolution path:
agent profile name -> models entry -> transport entry -> adapter

## Build order

Use this order to avoid fragile flows:
1. Declare external events first.
2. Define deterministic routing and state updates.
3. Add outputs/effects for each route.
4. Add agent(...) calls with returns contracts.
5. Add retry_on_contract_violation where useful.
6. Add on_contract_violation=emit(...) for explicit failure routing.
7. Add final fallback outputs for unresolved paths.

## Contract-first pattern

Write contracts before refining prompt text.

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

Guidelines:
- Keep contracts small and explicit.
- Prefer enum-bounded decision fields.
- Include "other" only when fallback behavior exists.
- Do not rely on prompts to replace missing contract boundaries.

## Deterministic routing pattern

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

## Effect and prompt guidance

Effect guidance:
- Use explicit output <channel> <value> statements.
- Prefer output json for structured payloads.
- Ensure each route has a visible effect or emitted event.

Prompt guidance:
- Keep prompt files domain-specific and brief.
- Describe intent mapping and fallback cues.
- Avoid restating runtime validation boilerplate already enforced by contracts.

## Quality bar

A generated workflow is in good shape when:
- every routing-critical agent decision has a returns contract
- decision enums are bounded and realistic
- fallback paths exist for "other" and/or violation events
- explicit branch logic controls effectful routes
- no effectful action depends on unconstrained free-text decisions

## Fast orientation

Start with these design anchors before writing workflow code:
- deterministic control flow first
- contract-first model boundaries
- explicit effect surface only (output/emit)
- fallback paths for ambiguous or invalid decisions

## Related platform guide

For platform/runtime semantics work, use:
- ../platform/platform-agent-guide.md
