# Nerveflow Agent Rules

This repository uses Nerveflow's deterministic workflow model.

Before generating or modifying workflows, review the project-generation docs:

## Required Reading

### Core workflow generation

- docs/project-generation/project-generator-guide.md
- docs/project-generation/workflow-generation-rules.md

### Language surface

- docs/project-generation/agent-language-reference.md

### Reliability and safety patterns

- docs/project-generation/workflow-checklists.md
- docs/project-generation/canonical-snippets.md

## Core Principles

### 1. Deterministic workflow controls execution

Routing should remain explicit and inspectable.
Do not hide control flow inside prompts.

### 2. Probabilistic decisions should be bounded

Routing-critical model calls should use explicit boundaries such as:
- returns
- decide
- try_bind

Avoid unconstrained free-text routing.

### 3. Effects should be explicit

User-visible behavior should use:
- output
- emit

Do not generate hidden prompt-side effects.

### 4. Use documented language features

Do not invent unsupported syntax, undocumented behavior, or implicit semantics.
The language references are authoritative.

## Generation Expectations

Generated workflows should:
- include fallback handling
- use explicit routing branches
- keep outputs inspectable
- remain deterministic under retries/failures
- preserve visible failure behavior

## Platform Boundary

This repository separates:
- platform/runtime engineering
- workflow/project generation

Project-generation agents should avoid runtime-semantic changes unless explicitly working on platform tasks.

## One-Line Philosophy

Deterministic structure governs probabilistic intelligence.
