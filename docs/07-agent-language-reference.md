# Agent Language Reference

Transition note: For the split project-generation docs, start with docs/project-generation/agent-language-reference.md.

This legacy page is being consolidated.

**For current reference, use:**
- docs/project-generation/agent-language-reference.md
- docs/03-language-reference.md (canonical syntax)

## Core semantics (reference)

- Statements: on, if/else, for i in, output, emit, agent, tool, script, operator
- Expressions: variables, interpolation, arithmetic, logical, function calls
- Integration calls: agent(...) with returns contracts, tool(...), script(...), operator(...)
- Contract semantics: enum-bounded fields, exact match, strict/coerce validation
- Retry/violation: retry_on_contract_violation, on_contract_violation routing
- Event model: emit queues, on handlers, on external for host ingress
- Output model: explicit channels (text, json, console, voice, visual, interaction)
