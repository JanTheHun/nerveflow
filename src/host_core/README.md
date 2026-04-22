# host_core

Shared host-side execution substrate for nextV hosts.

This directory exists to keep transport/protocol concerns out of core runtime logic while reusing proven host behaviors across web, CLI, and embedded hosts.

## Scope

Included:

- workspace config loading and validation
- host adapter assembly for tool/agent/script/operator calls
- runtime lifecycle helpers (state paths, timers, input normalization)
- runtime execution filtering helpers
- transport-independent fanout event bus

Explicitly excluded:

- HTTP routing
- SSE/WebSocket framing
- UI rendering
- runtime language semantics (owned by nextv_runtime)

## Layering

Dependency direction is intended to be:

nextv_runtime
-> host_core
-> surface hosts (web, CLI, embedded)

Surface hosts may depend on host_core.
host_core must not depend on transport or UI layers.

## Design Principles

- transport independence
- deterministic host behavior
- reusable host parity across surfaces
- no semantic duplication with runtime core

## Module Map

- workspace_config.js
- runtime_session.js
- runtime_controller.js
- runtime_lifecycle.js
- runtime_policy.js
- event_bus.js

## Key Contracts

### createHostAdapter (runtime_session.js)

Creates host adapter hooks used by runNextVScript host integration.

Behavior highlights:

- tool aliases resolve before allow-list checks
- allow-list deny returns deterministic policy error
- allowed-but-unimplemented tools return deterministic unavailable error
- script and operator calls route through runNextVScriptFromFile with output contract validation

### createNextVRuntimeController (runtime_controller.js)

Creates a transport-agnostic runtime session controller used by surface hosts.

Behavior highlights:

- centralizes runtime start/stop/enqueue/snapshot semantics
- preserves timer pulse publication and no-op suppression policy behavior
- emits canonical runtime lifecycle events through event_bus
- lets HTTP/SSE/WebSocket/SDK surfaces share one deterministic control layer

### loadWorkspaceNextVConfig (workspace_config.js)

Loads nextV workspace config from:

1. nextv.json inline blocks
2. nextv.json external refs (agentsConfig/toolsConfig/operatorsConfig)
3. fallback files (agents.json/tools.json/operators.json)

Includes tools alias cycle validation and normalized config source reporting.

### runtime_lifecycle helpers

- resolveOptionalStatePath
- resolveStateDiscoveryBaseDir
- resolveDiscoveredStatePath
- normalizeInputEvent
- timer handle helpers

These keep host path and timer semantics deterministic and reusable.

### runtime_policy helpers

- hasMeaningfulNextVExecutionEvents
- areJsonStatesEqual

Used by hosts to suppress no-op noise while preserving meaningful execution events.

### createEventBus (event_bus.js)

Simple transport-independent fanout event bus:

- publish(eventName, payload)
- subscribe(handler)
- unsubscribe(handler)
- size

## Usage

Typical host usage:

1. load workspace config via workspace_config
2. create adapter via runtime_session
3. create runner with runOptions.hostAdapter
4. apply runtime_policy and runtime_lifecycle helpers around host orchestration
5. publish host events through event_bus

See nerve-studio/preview-server.js for a reference host composition.
