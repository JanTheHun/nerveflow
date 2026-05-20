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
- ../07-agent-language-reference.md
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
