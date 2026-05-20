# Language Semantics Map (Project Generation)

This page is the self-contained language semantics map for project-generation agents.

Use this file when the wider repository docs are not present.

## Core execution model

- Workflow control is deterministic and explicit in script structure.
- Probabilistic model output is bounded through contracts.
- Effects are declared through `output` and `emit`.

## Contract and routing semantics

Use these boundaries for routing-critical model calls:

- `returns`
- `decide`
- `try_bind`

Reliability guidance:

- prefer `validate="strict"` for routing-critical outputs
- add bounded retries with `retry_on_contract_violation`
- route violations explicitly with `on_contract_violation=emit(...)`

## Minimal language checklist

- Keep control flow in workflow code (`on`, `if/else`, bounded `for`).
- Keep side effects explicit (`output`, `emit`).
- Avoid unconstrained free-text routing.
- Use fallback branches for `other` or ambiguous outcomes.

## Companion references in this folder

- workflow-generation-rules.md
- project-generator-guide.md
- workflow-checklists.md
- canonical-snippets.md
- platform-vision-context.md

## Rule of thumb

If a model result can change what happens next, encode that boundary structurally in workflow code and contracts.