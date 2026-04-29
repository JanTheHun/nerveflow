# Bounded Control-Flow Provenance (Exploratory)

Status: exploratory

## Goal

Make control-flow provenance visible when workflow branches and downstream paths are driven by contract-bounded agent decision data.

This feature is provenance visualization, not a safety or correctness guarantee.

## Principle

Contracts do not remove uncertainty.
They bound its influence.
Boundedness visualization makes that influence inspectable.

## Core terms

- bounded origin: value produced by an `agent(...)` call with an explicit output contract (`contract` or current `returns` form)
- bounded control: branch condition depends on bounded-origin values
- unbounded control: branch condition depends on data not proven bounded
- dependency-based: labels are derived from expression dependencies, not lexical region

Unbounded and unknown are distinct analysis outcomes; this wording keeps the unbounded notion tied to proof status.

## v1 scope

- annotate contract-bounded agent outputs as bounded-origin in analysis/IR
- classify condition provenance for workflow control points
- render optional boundedness overlay in editor/graph
- no warnings or enforcement in v1

## Classification model (proposed)

- bounded
- unbounded
- mixed
- unknown

Mixed means a control condition depends on both bounded and unbounded inputs.

## Dependency rule

A branch is bounded only when the condition expression actually depends on bounded-origin data.

Example:

```nrv
if state.mode == "debug"
```

This is not bounded solely because it appears downstream from a bounded decision.

## Annotation target

Primary annotation target is branch/control edges.
Node-level badges may be derived secondarily.

## Initial visualization direction

- bounded control: green/blue tint
- unbounded control: amber/red tint
- mixed control: striped or blended tint
- unknown control: neutral tint

Optional hover text:

```text
Control path depends on contract-bounded model output.
```

## Non-goals

This proposal does not claim:

- correctness
- complete safety
- policy compliance

## Future extension (not v1)

Optional diagnostics for effect routing influenced by unbounded model output.
