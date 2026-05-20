# Production Readiness Checklist

**Purpose:** Define enforceable gates for npm package releases. Every gate must **pass** before publishing.

**Decision Rule:** Ship only when **all seven gates pass**. Defer any gate failure to next release cycle.

---

## 1. Language Stability Gate

**Purpose:** Ensure DSL semantics and runtime behavior are deterministic, well-tested, and documented.

### Pass Criteria

- [ ] All language features documented in [docs/guide/03-language-reference.md](03-language-reference.md)
- [ ] Decision contract semantics finalized and tested per [design/specs/spec-structured-return-contracts.md](../../design/specs/spec-structured-return-contracts.md)
- [ ] Parallel evaluation and bounded control-flow provenance specified in [design/specs/spec-parallel-group-evaluation.md](../../design/specs/spec-parallel-group-evaluation.md) and [design/specs/spec-bounded-control-flow-provenance.md](../../design/specs/spec-bounded-control-flow-provenance.md)
- [ ] Agent language reference stable per [docs/project-generation/agent-language-reference.md](../project-generation/agent-language-reference.md)
- [ ] No breaking changes to DSL syntax or semantics without major version bump

### Fail Criteria

- Undocumented DSL changes
- Breaking language changes without documented migration path
- Decision contract semantics inconsistent between docs and code

### Validation Command

```bash
grep -r "decision\|contract\|determinism" docs/guide/03-language-reference.md design/specs/*.md
```

---

## 2. Runtime Determinism Gate

**Purpose:** Verify runtime core executes all workflows deterministically without hidden state or agent loops.

### Pass Criteria

- [ ] Runtime core path established in [src/runtime/index.js](../../src/runtime/index.js) exports (createRuntimeResolvers, createRuntimeCore, createRuntimeCommandRouter, createRuntimeWebSocketSurface)
- [ ] Event graph execution is deterministic per [src/nextv_event_graph.js](../../src/nextv_event_graph.js) and [tests/nextv_event_graph.test.js](../../tests/nextv_event_graph.test.js)
- [ ] All runtime tests pass, including [tests/runtime_core.test.js](../../tests/runtime_core.test.js), [tests/runtime_cli.test.js](../../tests/runtime_cli.test.js), [tests/runtime_ws_surface.test.js](../../tests/runtime_ws_surface.test.js)
- [ ] No hidden agent loops or implicit control flow in runtime authority
- [ ] Effect routing is explicit and auditable per event and contract

### Fail Criteria

- Runtime tests fail or are skipped
- Undocumented probabilistic behavior in runtime core
- Implicit state mutations in event bus or command router
- Agent-like inference loops in deterministic runtime context

### Validation Commands

```bash
npm test -- --match "*runtime*"
grep -n "Math.random\|crypto.*random\|probabilistic" src/runtime/*.js || echo "No undeclared randomness"
```

---

## 3. Safety Enforcement Gate

**Purpose:** Ensure all policy, auth, and failure-handling guarantees are enforceable and tested.

### Pass Criteria

- [ ] Policy enforcement documented in [docs/guide/05-platform-vision.md](05-platform-vision.md) "Operational Guarantees" section
- [ ] Host-core protocol auth and policy tested in [tests/host_protocol.test.js](../../tests/host_protocol.test.js)
- [ ] Runtime policy enforcement tested in [tests/runtime_policy.test.js](../../tests/runtime_policy.test.js)
- [ ] Failure model is first-class (not exception-only) per [docs/guide/05-platform-vision.md](05-platform-vision.md)
- [ ] Tool invocation safety and tool metadata validated per [src/tool_metadata.js](../../src/tool_metadata.js) and [tests/tool_runtime.test.js](../../tests/tool_runtime.test.js)

### Fail Criteria

- Policy tests fail or are skipped
- Unhandled exceptions in critical paths
- Tool invocations bypass safety checks
- Auth/session isolation tests fail

### Validation Commands

```bash
npm test -- --match "*policy*"
npm test -- --match "*protocol*"
npm test -- --match "*tool*"
```

---

## 4. Packaging Contract Gate

**Purpose:** Ensure published npm artifact is self-contained, exports are correct, and dependencies match runtime needs.

### Pass Criteria

- [ ] All documented subpath exports are declared in [package.json](../../package.json):
  - `"."` → `./src/index.js` (main API)
  - `"./runtime"` → `./src/runtime/index.js` (standalone runtime)
  - `"./host_core"` → `./src/host_core/index.js` (runtime substrate)
  - `"./host_core/protocol"` → `./src/host_core/protocol.js` (wire protocol)
  - `"./host-modules"` → `./src/host_modules/index.js` (capability compostion)
- [ ] Runtime dependencies include all imports used by published binaries and surfaces:
  - `ws` must be in `dependencies` (used by [src/runtime/ws_surface.js](../../src/runtime/ws_surface.js), [bin/nerve-attach.js](../../bin/nerve-attach.js))
  - `pg` in `dependencies` (used by [src/host_core/runtime_session.js](../../src/host_core/runtime_session.js) for config caching)
- [ ] Published CLI boundary is explicit:
  - Include: `nerve-runtime` (start standalone runtime), `nerve-attach` (attach to running instance), `nerve-model-check` (validate workflow)
  - Exclude: `nerve-dev-remote` (requires Studio assets not in published files)
- [ ] Regression test [tests/packaging_contract.test.js](../../tests/packaging_contract.test.js) passes, validating:
  - All documented exports are declared
  - `ws` is in dependencies, not devDependencies
  - `nerve-dev-remote` is not in published bin map

### Fail Criteria

- Packaging contract regression test fails
- Published binaries depend on unpublished files or missing dependency
- Exports map incomplete or inconsistent with docs
- Undeclared studio/UI coupling in published artifact

### Validation Commands

```bash
npm test -- packaging_contract.test.js
npm pack --json | jq '.files[] | select(.path | contains("nerve-studio")) | .path'
```

---

## 5. Packed Artifact Smoke Gate

**Purpose:** Verify that the npm tarball installs and runs self-sufficiently in isolation.

### Pass Criteria

- [ ] Automated smoke test [scripts/verify-pack-runtime-smoke.js](../../scripts/verify-pack-runtime-smoke.js) passes:
  - `npm pack` succeeds
  - Tarball installs in temp workspace
  - `nerve-runtime` boots with example workflow ([examples/minimal-web-host/workflow.nrv](../../examples/minimal-web-host/workflow.nrv))
  - `/health` endpoint responds 200 OK
  - `nerve-attach` connects via WebSocket and retrieves runtime snapshot
  - `/api/runtime/ingress` endpoint returns well-formed error (not missing dependency)
  - Temp workspace cleaned up

### Fail Criteria

- Smoke test fails or hangs
- Installed runtime missing required dependencies
- Binaries not executable or found in installed package
- WebSocket surface cannot attach or communicate

### Validation Commands

```bash
npm run test:pack-smoke
```

---

## 5.5 Editor-Core Companion Package Gate

**Purpose:** Ensure `@nerveflow/editor-core` publish candidate and Studio mirror integration remain deterministic.

### Pass Criteria

- [ ] Studio mirror sync check [scripts/verify-editor-core-sync.js](../../scripts/verify-editor-core-sync.js) passes:
  - `packages/editor-core/src` and `nerve-studio/public/editor-core` have identical paths and content
  - stale mirror files are rejected
- [ ] Editor-core pack check [scripts/verify-editor-core-pack.js](../../scripts/verify-editor-core-pack.js) passes:
  - `npm pack --json --dry-run` succeeds for [packages/editor-core/package.json](../../packages/editor-core/package.json)
  - packed paths are restricted to allowlist (`README.md`, `package.json`, `src/`, `docs/`)
  - required package entry points are present (`src/index.js`, `src/Surface.js`, `src/Renderer.js`, `src/Diagnostics.js`)
- [ ] Studio build path keeps import strategy stable:
  - [nerve-studio/public/src-app/15_surface_beta.js](../../nerve-studio/public/src-app/15_surface_beta.js) continues importing from `../editor-core/index.js`
  - [package.json](../../package.json) `build:studio` runs sync before [scripts/build-app-js.js](../../scripts/build-app-js.js)

### Fail Criteria

- Mirror drift detected between package source and Studio mirror
- Pack dry run includes disallowed files or misses required entry points
- Studio build no longer enforces sync-first behavior

### Validation Commands

```bash
npm run verify:editor-core-sync
npm run verify:editor-core-pack
npm run build:studio
```

---

## 6. CI Gate

**Purpose:** Enforce all tests and smoke validation in CI before merge, with results visible in PR status.

### Pass Criteria

- [ ] GitHub Actions workflow [.github/workflows/publish-gate.yml](../../.github/workflows/publish-gate.yml) configured:
  - Triggered on: pull_request, push to main, manual dispatch
  - Steps: checkout, setup Node 20, npm ci, npm test, npm run verify:editor-core-sync, npm run verify:editor-core-pack, npm run test:pack-smoke
  - All steps succeed
- [ ] Workflow marked as required check in branch protection rules (prevents merge if gate fails)
- [ ] Workflow logs visible in PR checks (users can debug failures)
- [ ] No test skips or flakes in CI (tests must be stable enough to enforce)

### Fail Criteria

- Workflow fails on main
- Required check not enforced (can merge despite failed gate)
- Intermittent test flakes block legitimate PRs
- Smoke test fails in CI but passes locally (environment issue)

### Validation Commands

```bash
git push origin <branch>  # Trigger workflow
# Check PR checks tab for publish-gate result
```

---

## 7. Docs and Positioning Gate

**Purpose:** Ensure all user-facing guidance is accurate, complete, and aligned with released artifact.

### Pass Criteria

- [ ] Getting started docs current in [docs/guide/02-getting-started.md](02-getting-started.md): npm install examples, CLI usage, first workflow
- [ ] Host integration docs current in [docs/guide/04-host-integration.md](04-host-integration.md):
  - Subpath export examples match [package.json](../../package.json) declarations
  - No references to unreleased experimental features
  - `nerve-dev-remote` documented as repository-only (not in published package)
- [ ] API reference [docs/guide/03-language-reference.md](03-language-reference.md) aligns with [src/index.js](../../src/index.js) and [src/runtime/index.js](../../src/runtime/index.js) exports
- [ ] README.md reflects current state:
  - CLI examples use published commands only
  - No auto-opening of Studio or dev tools
  - Architecture section matches [docs/guide/05-platform-vision.md](05-platform-vision.md)
- [ ] CHANGELOG.md Unreleased section documents all changes: new exports, moved dependencies, removed CLI tools, test automation
- [ ] Release checklist in [CONTRIBUTING.md](../../CONTRIBUTING.md) references production-readiness gates (this document)

### Fail Criteria

- Docs reference unreleased experimental features or future APIs
- Examples include unpublished CLI tools or imports
- Architecture narrative contradicts code
- CHANGELOG.md Unreleased section is empty or stale
- Users cannot follow docs to install and run published artifact

### Validation Commands

```bash
grep -n "nerve-dev-remote\|studio\|experimental" docs/guide/02-getting-started.md docs/guide/04-host-integration.md || echo "No unreleased references"
grep -n "npm install" README.md  # Verify install example present
```

---

## Pre-Publish Checklist

Run these commands in sequence before publishing to npm:

```bash
# 1. Full test suite
npm test

# 2. Smoke test (pack → install → boot → smoke)
npm run test:pack-smoke

# 2.5 Companion package sync + pack checks
npm run verify:editor-core-sync
npm run verify:editor-core-pack

# 3. Verify git state (no uncommitted changes)
git status

# 4. Update version (patch/minor/major)
npm version <patch|minor|major>

# 5. Verify CHANGELOG.md Unreleased section is now in version section
# (npm version and subsequent commit should auto-update this)

# 6. Dry run publish (verify contents)
npm publish --dry-run

# 7. Publish
npm publish

# 8. Verify npm package is available
npm info nerveflow@latest | grep "version\|description"

# 9. Smoke install from npm registry (optional, for high-confidence releases)
mkdir /tmp/smoke-final && cd /tmp/smoke-final && npm install nerveflow && npx nerve-runtime --help
```

---

## Summary

**Gates are enforceable because:**
- Language stability → documented in specs, tested by compiler/runtime
- Runtime determinism → tested by runtime_core.test.js, event_graph.test.js
- Safety enforcement → tested by policy.test.js, protocol.test.js
- Packaging contract → tested by packaging_contract.test.js (new)
- Packed artifact smoke → tested by verify-pack-runtime-smoke.js (new)
- CI gate → enforced by GitHub Actions workflow (new)
- Docs and positioning → human review, but anchored to file references (new)

**When to defer a gate:**
If a gate fails and the cause cannot be fixed in the current release cycle, defer the release and file an issue linked to the gate. Do not work around the gate.

**When to update gates:**
If product architecture changes (e.g., new export, moved dependency, new safety guarantee), update the relevant gate criteria AND the gate tests before publishing.

---

## Related Documentation

- [Platform Vision & Operational Guarantees](05-platform-vision.md)
- [Project Generator Guide](../project-generation/project-generator-guide.md)
- [Decision Contract Specification](../../design/specs/spec-structured-return-contracts.md)
- [Host Integration Guide](04-host-integration.md)
- [Contributing & Release Checklist](../../CONTRIBUTING.md)
