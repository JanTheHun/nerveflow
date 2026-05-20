# Agent Language Reference (Project Generation)

This page is the project-generation entrypoint for language usage.

Authoritative language and semantics references:
- ../guide/03-language-reference.md
- ../../design/specs/spec-structured-return-contracts.md
- workflow-generation-rules.md

Use this page as a compact map.

## Core statements and flow

Use explicit control flow primitives documented in:
- workflow-generation-rules.md (workflow-generation usage)
- ../guide/03-language-reference.md (full language reference)

Quick usage guidance:
- keep effectful behavior inside explicit on/if/else structures
- keep loops bounded with for i in start..end
- avoid standalone expressions that do not affect state/output

## Contract-bounded calls

When model output influences routing/effects, use explicit contracts and validation semantics as documented in:
- ../../design/specs/spec-structured-return-contracts.md
- workflow-generation-rules.md

Common shape:

```nrv
decision = agent(
	"router",
	event.value,
	returns={ intent:["chat","search","other"] },
	validate="strict",
	retry_on_contract_violation=1,
	on_contract_violation=emit("contract_violation", violation)
)
```

Contract reminders:
- enum literals are exact-match values
- unknown enum values fail validation
- wildcard enum values are invalid

## Event and effect surface

Use explicit event/effect semantics documented in:
- workflow-generation-rules.md
- ../guide/05-platform-vision.md

Project-generation guidance:
- use output json for structured payloads
- ensure route boundaries end in explicit output or emit behavior
- avoid hiding effectful intent inside prompt text

## Integration calls map

For project workflows, these calls are the common boundaries:
- agent(...): bounded probabilistic decision or extraction call
- tool(...): host-backed tool integration
- script(...): host-backed script/process integration
- operator(...): host-backed operator integration

Detailed call semantics are defined in:
- ../guide/03-language-reference.md

## Quick rule of thumb

If a model result can change what happens next, define that boundary structurally in workflow code and contracts.
