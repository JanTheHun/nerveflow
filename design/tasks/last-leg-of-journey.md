# Last Leg of the Journey

**Status:** proposed execution plan

**Motto:** Make intelligence bounded. Make deployment boring.

## Outcome

A common user can create, configure, run, inspect, and deploy a useful DIY AI assistant without first learning the Nerveflow DSL or assembling runtime infrastructure by hand.

The resulting assistant remains a normal, inspectable Nerveflow project. Advanced users can progressively reveal and edit its workflows, contracts, capabilities, and host configuration.

## Product Boundary

The first supported product journey is deliberately narrow:

1. Start in Conversation Composer.
2. Choose a model.
3. Add Markdown system instructions.
4. Enable governed tools or MCP capabilities.
5. Test the assistant locally.
6. Export a standalone Nerveflow project.
7. Deploy it as one supported containerized application.
8. Retain conversations across restart and inspect failures safely.

This plan does not require delegated operators, a visual workflow editor, multi-agent autonomy, hosted Nerveflow infrastructure, or arbitrary distributed execution.

## Planning Model

The hierarchy is:

```text
Program -> Domain -> Epic -> Task -> Pull request
```

- **Domains** describe stable areas of responsibility.
- **Epics** deliver independently meaningful capabilities.
- **Tasks** are issue-sized, testable units of work.
- **Pull requests** should normally implement one task.

GitHub Issues are the operational source of truth after issue creation. This document preserves product intent, architecture, ordering, and acceptance criteria.

## Delivery Rules

1. Keep the main branch green between dependency waves.
2. Resolve shared contracts before parallel implementation begins.
3. Give each task a measurable acceptance test and explicit non-goals.
4. Do not assign two parallel tasks to the same central implementation files.
5. Merge foundational tasks before dispatching their dependents.
6. Re-plan later waves from merged reality instead of expanding the entire backlog upfront.
7. A Copilot-authored pull request receives the same human review and CI requirements as any other pull request.

## Labels

Use these GitHub labels:

- `domain:foundation`, `domain:product`, `domain:runtime`, `domain:security`, `domain:deployment`, `domain:quality`
- `type:epic`, `type:task`, `type:decision`
- `priority:p0`, `priority:p1`, `priority:p2`
- `copilot:ready`, `copilot:blocked`, `human:decision-required`
- `risk:contract`, `risk:runtime`, `risk:security`, `risk:integration`, `risk:docs`

## Definition of Ready

A task is `copilot:ready` only when it has:

- one owning epic;
- bounded scope and likely files;
- explicit dependencies;
- acceptance criteria;
- required validation commands;
- documentation impact;
- explicit non-goals;
- no unresolved product or architecture decision.

## Definition of Done

A task is done when:

- acceptance criteria pass;
- focused tests cover success and relevant failure behavior;
- public behavior and compatibility impact are documented;
- generated artifacts and examples remain aligned where applicable;
- no high or critical production dependency advisory is introduced;
- the pull request contains no unrelated changes.

# Domain A: Foundation and Contract Stability

## Epic A1: Recover a Trustworthy Baseline

**Outcome:** The repository has a reproducible green baseline before product work branches.

### A1.1 Classify and capture current test failures

- Re-run the full suite from a clean checkout.
- Group failures into product defects, stale fixtures, generated-asset prerequisites, environment-dependent integration tests, and flaky timing.
- Publish the approved skip policy for services such as PostgreSQL.

**Acceptance:** Every failure has an owning task; CI-critical suites have no unexplained skip or failure.

**Execution:** central, first task.

### A1.2 Make test fixtures self-contained

- Replace dependencies on removed `nerve-studio/workspaces-local` content with test-owned temporary fixtures.
- Ensure compose tests create their own temporary parent directories.

**Acceptance:** Relevant compose and MQTT tests pass from a clean clone without local scratch files.

**Execution:** `copilot:ready` after A1.1; safe to isolate by test family.

### A1.3 Build Composer runtime assets before tests

- Establish a deterministic pretest/build contract for the embedded runtime bundle.
- Fail with an actionable message when generation cannot complete.

**Acceptance:** Root CI can run Composer tests from a clean clone without a manually prebuilt bundle.

**Execution:** `copilot:ready` after A1.1.

### A1.4 Repair isolated runtime and Studio regressions

Create separate tasks for:

- Windows-style workspace path normalization;
- `history_query.total` fallback behavior;
- remote Studio call-inspector metadata preservation.

**Acceptance:** Each regression has a focused test and the full affected suite passes.

**Execution:** three parallel `copilot:ready` tasks after A1.1.

## Epic A2: Converge Capability Identity

**Outcome:** MCP and native capabilities use one documented identity model everywhere.

### A2.1 Approve the canonical identity contract

Decide and document the relationship between server namespace, operation key, public capability ID, aliases, and policy matching. Include migration behavior for legacy dotted MCP operation names.

**Acceptance:** One reviewed platform decision covers adapter, scaffold, configuration, diagnostics, examples, and compatibility.

**Execution:** `human:decision-required`; blocks A2.2-A2.4.

### A2.2 Align runtime and host adapters

**Acceptance:** Capability IDs cannot receive duplicate namespaces, and policy checks use the canonical resolved identity.

### A2.3 Align `nerve-compose` scaffolding

**Acceptance:** A newly scaffolded MCP project validates, boots, and invokes its sample capability using the canonical identity.

### A2.4 Align tests, examples, guides, and changelog

**Acceptance:** No shipped example or documentation teaches the legacy-invalid form; migration diagnostics are tested.

**Execution:** A2.2-A2.4 may be divided only when file ownership is non-overlapping; otherwise use one cross-layer PR.

## Epic A3: Freeze Shipped Language Contracts

**Outcome:** Implemented language behavior is explicitly stable enough to build a user product on top of it.

### A3.1 Create a language conformance matrix

Map each shipped construct to its specification, language-reference section, parser/compiler test, runtime test, diagnostic codes, and compatibility status.

### A3.2 Finalize implemented specifications

Reconcile shipped behavior with draft or exploratory documents for `decide`, explicit failure envelopes, parallel evaluation, and bounded-control provenance.

### A3.3 Define compatibility and deprecation policy

Cover DSL syntax, IR/runtime contracts, configuration schema, protocol envelopes, and legacy `nextv` naming.

**Acceptance:** Every documented language feature has an implementation-backed test path and a declared stability status.

**Execution:** A3.1 is `copilot:ready`; A3.2 and A3.3 require human contract review.

# Domain B: Common-User Product Experience

## Epic B1: Define the Assistant Project Contract

**Outcome:** Composer, CLI, Studio, generated hosts, and deployment target the same versioned project shape.

### B1.1 Specify the generated project manifest

Define files, configuration schema version, model references, system instructions, capability grants, state store, public surface, deployment profile, and migration metadata.

### B1.2 Define the default assistant template

The first template provides:

- browser chat UI;
- one conversation endpoint;
- system Markdown instructions;
- one selected model;
- governed capabilities;
- durable local conversation storage;
- health and readiness endpoints.

### B1.3 Add configuration validation and migration rules

**Acceptance:** Invalid projects fail before startup with actionable diagnostics; supported older schemas migrate or produce a documented error.

**Execution:** B1.1 and B1.2 are human-reviewed contracts. B1.3 follows them.

## Epic B2: Conversation Composer as the Front Door

**Outcome:** A user builds a working assistant without editing JSON or Nerveflow source.

### B2.1 Preserve system instructions in generated behavior

Ensure selected Markdown system files become ordered system messages in the generated assistant workflow/profile.

**Acceptance:** Focused tests prove content and ordering survive from Composer selection to model request.

**Execution:** immediate `copilot:ready` defect fix.

### B2.2 Add provider preflight

Validate model configuration, credentials reference, and connectivity before the first conversation.

### B2.3 Export a standalone project

Export the versioned project contract from B1, without embedding secret values.

### B2.4 Import and edit an existing generated project

Preserve unsupported advanced configuration instead of silently rewriting it.

**Acceptance:** A Composer prototype exports, runs independently, and produces equivalent model/system/tool behavior.

**Dependencies:** B2.3-B2.4 require B1.

## Epic B3: Progressive Studio Experience

**Outcome:** Common users see assistant status and recovery actions first; platform internals remain available on demand.

### B3.1 Define Builder and Workbench modes

Builder mode exposes conversation, model, instructions, tools, storage status, and deployment status. Workbench mode preserves current graph, source, state, call inspector, ingress, and replay tools.

### B3.2 Add guided failure states

Cover missing credentials, unavailable model, denied capability, invalid project, disconnected runtime, and unavailable storage.

### B3.3 Add deployment/status panel

Show health, readiness, version, storage, active model, and redacted recent failures.

**Acceptance:** A user can identify and recover from each supported setup failure without inspecting terminal logs.

# Domain C: Durable and Secure Runtime

## Epic C1: Identity and Session Contract

**Outcome:** All state, effects, logs, and control operations have a consistent request, user, session, and execution identity.

### C1.1 Specify identity and correlation fields

Define propagation across HTTP, WebSocket, runtime events, model calls, tool calls, history, and Studio artifacts.

### C1.2 Enforce per-session state isolation

### C1.3 Define redaction boundaries

**Acceptance:** Concurrent users cannot observe or mutate one another's conversation or control state; one correlation ID traces a request across runtime and host boundaries without exposing secrets.

**Execution:** `human:decision-required`; blocks persistence, auth, and production telemetry.

## Epic C2: Durable Conversation Storage

**Outcome:** The default assistant retains state safely across process restart.

### C2.1 Define the storage interface and migration lifecycle

### C2.2 Implement SQLite as the single-node default

### C2.3 Implement PostgreSQL as the multi-instance option

### C2.4 Add backup, restore, and migration verification

**Acceptance:** Restart retains isolated conversations; migration and interrupted-write tests pass; storage readiness is observable.

**Dependencies:** C1 before C2.2-C2.3. SQLite and PostgreSQL adapters can proceed in parallel after C2.1.

## Epic C3: Authentication and Authorization

**Outcome:** Remote runtime control is not anonymously available.

### C3.1 Define local and remote exposure profiles

Local mode remains easy and loopback-bound. Remote mode requires explicit authentication configuration.

### C3.2 Authenticate HTTP and WebSocket ingress

### C3.3 Authorize observe, converse, and administer operations

### C3.4 Add origin, request-size, and rate policies

**Acceptance:** Anonymous remote requests receive `401`; authenticated but unauthorized control requests receive `403`; local defaults remain usable and explicit.

**Dependencies:** C1. Implementation tasks may split by HTTP, WebSocket, and policy after the shared contract merges.

## Epic C4: Runtime and Host Boundary Hardening

**Outcome:** Runtime authority and host capability ownership match the documented dependency direction.

### C4.1 Specify the target module dependency boundary

### C4.2 Remove circular runtime/host-core ownership

### C4.3 Stabilize history and call-inspector artifact schemas

**Acceptance:** An automated architecture check rejects forbidden dependency direction; embedded, remote, CLI, and Studio surfaces pass shared artifact-schema tests.

**Execution:** central/high-conflict work; do not parallelize C4.2 with broad runtime changes.

# Domain D: Boring Deployment

## Epic D1: Reproducible Container

**Outcome:** The supported image starts securely and is reachable through its documented published port.

### D1.1 Fix container network binding

Add an explicit host/bind option; preserve loopback defaults outside the container and bind appropriately in the container profile.

### D1.2 Make image builds reproducible and non-root

Use the lockfile and deterministic install, run as an unprivileged user, and minimize the runtime image.

### D1.3 Add container health and readiness checks

### D1.4 Add an external connectivity smoke test

**Acceptance:** A clean image build boots, becomes ready, responds through the published host port, rejects unauthorized remote control when enabled, and shuts down cleanly.

**Execution:** D1.1 is an immediate `copilot:ready` defect fix. D1.2 can run in parallel. D1.3-D1.4 follow the health contract.

## Epic D2: Deployable Generated Application

**Outcome:** Exported projects run locally and in the supported container without repository internals.

### D2.1 Generate package metadata and public imports

Generated hosts use declared `nerveflow` package exports, not `node_modules/nerveflow/src/...` paths.

### D2.2 Generate environment schema and secret references

Include `.env.example` but never secret values.

### D2.3 Generate Docker and persistent-volume configuration

### D2.4 Add generated-project smoke tests

**Acceptance:** `npm install && npm test && npm start` succeeds in an exported project, followed by a containerized conversation that survives restart.

**Dependencies:** B1, C2, and D1.

## Epic D3: Deployment Operations

**Outcome:** A user can operate and update the supported deployment safely.

### D3.1 Document reverse proxy and TLS termination

### D3.2 Define upgrade and rollback procedure

### D3.3 Define backup and restore procedure

### D3.4 Add deployment diagnostics command

**Acceptance:** A release upgrade, failed upgrade rollback, backup, and restore are exercised in an automated or scripted acceptance environment.

# Domain E: Release Quality and Adoption

## Epic E1: Production Observability

**Outcome:** Operators can understand health and failures without exposing user data or credentials.

### E1.1 Specify structured event and redaction contracts

### E1.2 Add correlated structured logs

### E1.3 Add health, readiness, and core metrics

### E1.4 Define retention and export behavior

**Acceptance:** Every execution reports correlation ID, duration, outcome, and model/tool timing with tested redaction.

**Dependencies:** C1 and C1.3.

## Epic E2: Common-User Documentation

**Outcome:** Documentation presents one canonical journey before platform internals.

### E2.1 Write the ten-minute assistant quickstart

### E2.2 Reconcile Studio persistence claims

### E2.3 Include onboarding documentation in the npm artifact

### E2.4 Add tested troubleshooting and deployment guides

### E2.5 Curate a small assistant template catalog

**Acceptance:** All documented commands run against the packed artifact; a clean user test reaches a working local assistant in under ten minutes without editing JSON or `.nrv`.

**Execution:** E2.2 and package-link validation are immediate `copilot:ready` tasks. Later docs follow merged product behavior.

## Epic E3: Automated Product Release Gate

**Outcome:** Release readiness is executable rather than represented by a stale checkbox document.

### E3.1 Separate CI jobs by responsibility

Use explicit unit, integration, extension, package, container, and security jobs.

### E3.2 Enforce dependency and architecture checks

Require no high or critical production advisories and no forbidden module dependency cycles.

### E3.3 Add end-to-end product acceptance

Exercise create, configure, converse, export, deploy, restart, inspect, and upgrade.

### E3.4 Automate version, changelog, tag, and package consistency

**Acceptance:** A release candidate passes all gates twice from clean CI and produces matching package version, changelog entry, Git tag, and package artifact.

# Dependency Waves

## Wave 0: Establish Truth

- A1.1 classify the baseline.
- A2.1 approve capability identity.
- B1.1-B1.2 approve the assistant project and default product boundary.
- C1.1 and C1.3 approve identity/correlation and redaction.
- C4.1 approve runtime/host dependency direction.

Only A1.1 is implementation-free enough to begin without another contract decision.

## Wave 1: Green Baseline and Immediate Defects

Parallel candidates:

- A1.2 self-contained fixtures;
- A1.3 Composer bundle pretest;
- A1.4 isolated runtime/Studio regressions as separate tasks;
- B2.1 Composer system instructions;
- D1.1 container binding;
- D1.2 deterministic non-root image;
- E2.2 Studio documentation correction;
- npm artifact onboarding/link verification from E2.3.

Exit criterion: clean required test baseline and independently verified package/container smoke paths.

## Wave 2: Shared Product Contracts

- Complete A2 and A3.
- Complete B1.
- Complete C1 and C4.1.
- Define storage, authentication, health, and telemetry interfaces.

Exit criterion: no implementation task in later waves depends on an unresolved schema or authority decision.

## Wave 3: Build the Vertical Product Slice

Parallel workstreams after contracts merge:

- Composer export/import;
- default assistant UI and guided failures;
- SQLite persistence;
- HTTP/WS authentication and authorization;
- correlated observability;
- generated application and container deployment.

Exit criterion: one user can create, export, deploy, restart, and inspect one useful assistant securely.

## Wave 4: Harden and Broaden

- PostgreSQL and multi-instance behavior;
- deployment upgrade, rollback, backup, and restore;
- advanced Studio operator experience;
- curated templates;
- architecture cleanup and full release automation.

Exit criterion: all product release gates pass from clean CI.

# First GitHub Issue Batch

Create only this first batch initially:

1. **Epic: Recover a trustworthy test baseline** (`A1`)
2. **Task: Make compose and MQTT fixtures self-contained** (`A1.2`)
3. **Task: Build Composer embedded runtime before root tests** (`A1.3`)
4. **Task: Normalize Windows-style workspace paths** (`A1.4a`)
5. **Task: Restore `history_query.total` contract** (`A1.4b`)
6. **Task: Preserve remote Studio call-inspector metadata** (`A1.4c`)
7. **Decision: Canonical capability identity** (`A2.1`)
8. **Task: Preserve Composer system instructions** (`B2.1`)
9. **Task: Make Docker runtime reachable without weakening local defaults** (`D1.1`)
10. **Task: Make the runtime image reproducible and non-root** (`D1.2`)
11. **Task: Reconcile Studio persistence documentation** (`E2.2`)
12. **Task: Verify packaged onboarding links and content** (`E2.3`)

After the decision issues merge, create the detailed Wave 2 batch. Do not create all later tasks yet.

# GitHub Copilot Cloud Operating Model

1. Create one GitHub issue per task using the stable task ID in the title.
2. Link each task to its epic and record `Depends on: #...` explicitly.
3. Apply `copilot:ready` only after Definition of Ready is satisfied.
4. Assign independent Wave 1 issues to Copilot in parallel.
5. Keep decision issues and central shared-contract work human-owned.
6. Require focused validation output in every pull request description.
7. Merge low-conflict fixes first; rebase or regenerate tasks whose assumptions changed.
8. Run the complete release gate after each wave, not after every small documentation-only PR.

## Pull Request Review Checklist

- Does the implementation satisfy the issue acceptance criteria?
- Does it preserve deterministic control, explicit effects, and visible failures?
- Does it alter a public contract or generated artifact unexpectedly?
- Are success and failure paths tested?
- Are secrets and user content redacted?
- Does it conflict with another active task's file ownership?
- Are user-facing docs accurate after the change?

# Program Exit Criteria

The Last Leg is complete when:

- a new user reaches a working local assistant in under ten minutes without editing JSON or `.nrv`;
- Composer exports a standalone project with equivalent model, instruction, and capability behavior;
- the generated project installs, tests, runs, and deploys using public package interfaces;
- conversations survive restart and remain isolated between users;
- remote HTTP and WebSocket control require authentication and enforce authorization;
- no API key appears in generated files, logs, runtime snapshots, Studio events, or Git status;
- health and readiness distinguish process, runtime, model, and storage state;
- one execution is traceable across model and tool calls using redacted correlation metadata;
- npm package, editor-core package, Composer bundle, and container pass isolated smoke tests;
- required CI has zero failures, zero unexplained skips, and no high or critical production advisories;
- release version, changelog, Git tag, and published artifacts agree.
