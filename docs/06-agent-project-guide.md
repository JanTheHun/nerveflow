# Agent Project Guide

Transition note: For the split project-generation docs, start with docs/project-generation/project-generator-guide.md.

This legacy page is being consolidated.

**For current guidance, use:**
- docs/project-generation/project-generator-guide.md
- docs/project-generation/workflow-generation-rules.md

## Key concepts (reference)

- Minimum shape: workflow.nrv + nextv.json + contracts/ + prompts/
- Configuration: transports registry, models registry, agent profiles
- Build order: external events ? routing ? outputs ? agent calls ? retries ? violations
- Contract-first: write contracts before prompts
- Deterministic routing: explicit if/else on bounded enum decisions
- Failure handling: on_contract_violation routing
- Effect surface: explicit output and emit statements only
