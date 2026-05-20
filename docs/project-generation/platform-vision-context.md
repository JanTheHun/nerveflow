# Platform Vision Context (Project Generation)

This page gives project-generation agents a local, self-contained platform context.

## Three-part design center

1. Deterministic Workflow: execution spine
2. Decision Contracts: cognition boundary
3. Event and Effect Surface: world interface

Shared philosophy:

> Deterministic structure governs probabilistic intelligence.

## Project-generation boundary

Project-generation work should:

- generate and modify workflow projects
- consume platform semantics without redefining them
- keep routing and effects inspectable

Project-generation work should avoid:

- runtime-semantic changes
- compiler/lowering behavior changes
- protocol-surface behavior changes

## Escalation guidance

When a request implies runtime/compiler/language-semantic changes, escalate to platform engineering guidance in the full repository docs before implementing behavior changes.

Within this profile, treat such requests as out-of-scope for direct workflow generation edits.

## Practical checks before generation

- Is control flow explicit in workflow code?
- Are model decisions bounded by contracts?
- Are outputs/events declared and inspectable?
- Are fallback and violation paths visible?

If any answer is no, revise structure before prompt tuning.