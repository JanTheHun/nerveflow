# Platform Engineering Agent Guide

This guide is for agents working on the Nerveflow platform itself.

Scope:
- runtime behavior and semantics
- compiler/lowering behavior
- host-core/runtime boundary decisions
- protocol and surface semantics
- architecture and specification alignment

Shared philosophy:

> Deterministic structure governs probabilistic intelligence.

## Primary references

Read these first:
- ../05-platform-vision.md
- ../guide/03-language-reference.md
- ../../design/specs/spec-structured-return-contracts.md
- ../../design/specs/spec-explicit-runtime-failure-envelopes.md
- ../../design/specs/spec-decide-contract.md

## Informational responsibilities

Platform engineering agents should preserve and evolve:
- deterministic execution and inspectable control flow
- explicit effect routing
- bounded model decision semantics via contracts
- clear host/runtime separation

## Platform principles

1. Determinism is the execution spine.
2. Runtime authority remains singular.
3. Effects should remain explicit and inspectable.
4. Probabilistic output should pass through workflow structure and contracts.
5. Host capabilities compose around runtime core boundaries.
6. Syntax convenience should not weaken inspectability or IR clarity.
7. Language features should map cleanly to explicit lowering behavior.

## Experimental System One Decisions

The `experimental.systemone` transport is a host-level experiment for TypeSafe/Jev-compatible decision services, including Ollama 0.35+ decision models such as Tev1, Nimble, and Clef Flash. It maps scalar `decide=[...]` calls to one `choice` question and maps `system_one={ state, questions, images? }` calls directly to the named typed-question protocol at `/v1/systemone`.

The experiment preserves explicit DSL lowering, contract validation, bounded-control provenance, and failure routing. The host adapter retains Nerveflow's exact-literal `decide` validation and validates `system_one` response types, criteria membership, score ranges, and probabilities before returning typed results. The compiler marks static typed calls as `contract_kind: "system_one"` for graph inspection.

The shared typed envelope permits 1 to 64 named questions. `choice` and `score` accept 2 to 26 criteria; `noul` accepts optional true/false descriptions. `state` may be text, an object, or an array. Images are only accepted when the configured transport declares `systemOneImages: true`; the runtime does not infer model capabilities from a model name. Provider confidence, probabilities, usage, resolved model, request ID, raw answers, and typed answer metadata remain observable.

The transport explicitly rejects chat-only or conflicting behavior (`messages`, event images, tools, free-form output, structured `returns`, `validate`, retries, and contract-failure handlers) rather than emulating those capabilities. `decide` and `system_one` are mutually exclusive.

## Typical platform work areas

Platform engineering may involve:
- runtime semantics and failure behavior
- parser/compiler/lowering behavior
- host_core and runtime authority boundaries
- host module capability composition
- protocol surface behavior and docs/spec alignment

## Documentation alignment notes

When language behavior changes, align:
- ../guide/03-language-reference.md
- ../../design/specs/spec-structured-return-contracts.md
- any affected spec pages under ../../design/specs/

When agent-oriented workflow guidance changes, align with:
- ../project-generation/project-generator-guide.md
- ../project-generation/workflow-generation-rules.md

## Working mode (informational)

When documenting or proposing platform changes:
1. Describe behavior first, then implementation shape.
2. Keep runtime semantics explicit and inspectable.
3. Prefer minimal, proven slices over broad speculative refactors.
4. Align user-visible language behavior with the canonical references.

## Non-goal for this guide

This guide does not define workflow/project generation patterns. For that layer, use:
- ../project-generation/project-generator-guide.md
