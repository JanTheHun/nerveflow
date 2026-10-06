# System One Decision Contract (Experimental v1)

**Status:** draft

## Purpose

Provide a deterministic Nerveflow boundary for TypeSafe/Jev-compatible decision services. The contract exposes their typed, named decision protocol without treating provider output as unconstrained chat text.

`system_one` is available on `agent(...)` and `model(...)` only when the resolved transport provider is `experimental.systemone`. It is separate from scalar `decide=[...]` and structured JSON `returns={...}`.

## Syntax

```nrv
result = agent(
  "decision-model",
  event.value,
  system_one={
    state: { request: event.value },
    questions: {
      route: {
        type: "choice",
        instructions: "Which route applies?",
        criteria: { billing: "Payments", technical: "Errors", other: "No match" }
      },
      allowed: {
        type: "noul",
        instructions: "Is this request allowed?"
      },
      urgency: {
        type: "score",
        instructions: "How urgent is this request?",
        criteria: ["Low", "Medium", "High"]
      }
    }
  }
)
```

## Request Contract

1. `state` is required and must not be null. It may be a string, object, or array.
2. `questions` is a named object containing 1 to 64 questions.
3. Every question has a non-empty name, a supported `type`, and non-empty `instructions`.
4. `choice` requires an object of 2 to 26 non-empty option names, each described by a string or `null`.
5. `noul` accepts no criteria or an optional object containing only `true` and `false` non-empty descriptions.
6. `score` requires an ordered array of 2 to 26 non-empty string levels. Levels are numbered from 0.
7. `images` is optional and contains non-empty base64 strings. It is only valid when the configured transport has `systemOneImages: true`.

## Result Contract

The result is an object keyed by question name. Each answer includes its declared `type`.

- `choice`: `choice`, optional `probabilities`, optional `confidence`.
- `noul`: `noul`, a finite number from 0 to 1.
- `score`: `score`, `legend`, optional `probabilities`, optional `confidence`.

Nerveflow rejects a provider response when a named answer is missing, has the wrong type, selects an undeclared choice, has an out-of-range score, has a mismatched score legend, or contains an invalid probability or confidence. These are `SYSTEMONE_INVALID_RESPONSE` transport failures, never silently corrected values.

## Compatibility

`system_one` is mutually exclusive with `decide`, `returns`, `format`, `validate`, `messages`, governed `tools`, `retry_on_contract_violation`, and `on_contract_violation`. It is not a chat fallback. Event images are not accepted; decision images must be declared directly in `system_one.images` and explicitly enabled by transport configuration.

Existing `decide=[...]` semantics remain unchanged: it sends exactly one choice question, validates the plain-text answer using `decide_v1` normalization, and returns the declared scalar literal.

## Observability and Provenance

Static calls are annotated in IR with `contract_kind: "system_one"` and their declared question schema. Request inspectors expose question names, types, counts, and image counts without embedding image data. Successful typed answers are bounded origin because Nerveflow validates them against the declared System One schema before they reach workflow control flow.