# Agent Checklists

Use these checklists when generating or modifying Nerveflow projects.

## 1. Pre-Generation Checklist

- Define external event types the workflow must handle.
- Define required outputs/effects and channels.
- Identify all probabilistic decisions that require contracts.
- Choose fallback behavior for ambiguous decisions.
- Decide if contract violations should retry, route, or fail.

## 2. Script Construction Checklist

- Add `on external` ingress handlers first.
- Add deterministic routing (`if / else if / else`) second.
- Add outputs/effects for each branch.
- Add `agent(...)` calls with `returns` contracts.
- Add `retry_on_contract_violation` only where useful.
- Add `on_contract_violation=emit(...)` for explicit failure handling.

## 3. Contract Checklist

- Contract is present for every routing-critical model call.
- Enum fields are bounded to realistic decision sets.
- `"other"` exists only when fallback path exists.
- No wildcard enum values are used.
- Contract files are loaded via `from_json(file(...))` when externalized.

## 4. Routing Checklist

- All enum outcomes are handled explicitly.
- `"other"` branch is present when needed.
- Contract violation handler branch exists if configured.
- No branch silently drops effectful intent.

## 5. Effect Surface Checklist

- Every user-visible behavior uses explicit `output` or emitted events.
- Channels match declared host capabilities.
- Structured payloads use `output json` when appropriate.
- There are no hidden prompt-only side effects.

## 6. Reliability Checklist

- Retries are bounded (`0..N`, no unbounded loops).
- Validation is not bypassed in retry paths.
- Violation handling produces deterministic behavior.
- Error messages are user-repairable where possible.

## 7. Review Checklist For PRs

- Workflow remains deterministic under failure cases.
- Decision contracts reflect current domain vocabulary.
- Prompt text is domain-specific, not generic formatting boilerplate.
- Docs examples match actual supported language features.
- New behavior has tests where runtime semantics changed.

## 8. Fast Acceptance Gate

Approve only if all are true:

- bounded decisions
- explicit control flow
- declared effects
- visible failure handling
- no unconstrained effectful model outputs
