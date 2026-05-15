# Decide Contract — Specification (v1.1)

**Status:** draft

---

## Purpose

Provide a minimal, deterministic contract mode for extracting one bounded decision from model output without requiring structured JSON output.

`decide` is a **scalar binding contract** on `agent(...)` — the simplest possible trust boundary in the binding model. It constrains model output to a finite set of string literals with immediate strict validation, returning a bounded scalar value directly. No structured output is required.

---

## Syntax

```nrv
value = agent(
  "agent_name",
  input,
  decide=["option1","option2","option3"]
)
```

---

## Contract Definition

1. `decide` MUST be an array literal.
2. `decide` MUST contain at least 2 elements.
3. Every element MUST be a string literal.
4. Empty string values are invalid.
5. The runtime config validator MUST reject duplicate options after canonicalization (see Normalization). This is a programmer error, not a model-output failure.
6. `decide` and `returns` are mutually exclusive. Combining them is `INVALID_CALL_CONFIG`.

---

## No JSON Requirement

The runtime MUST NOT require JSON-formatted output when `decide` is used.

`decide` is specifically designed for models that return plain text. Structured output is not expected, not parsed, and not validated as JSON.

---

## Normalization

Define a deterministic normalization function `N(text)`.

`N(text)` is applied identically to both model output and declared option literals before comparison. The full normalization algorithm is specified in the Implementation Notes.

Summary of steps:

1. Trim leading and trailing Unicode whitespace.
2. Fold ASCII `A`–`Z` to `a`–`z` (non-ASCII characters are left unchanged).
3. Repeatedly strip leading and trailing ASCII punctuation until neither edge is a punctuation character.
4. Do not modify internal characters.

The full ASCII punctuation character set and edge cases are defined in the Implementation Notes.

---

## Validation Rule

Let `O` be the set of canonicalized options:

```
O = { N(option_i) for each declared option }
```

Validation succeeds when:

```
N(model_output) ∈ O
```

Otherwise the call is a contract violation. No fuzzy matching is permitted.

---

## Return Value

**The returned value MUST always be the declared option literal whose canonicalized form matched.**

Example:

- `decide=["chat","search","other"]`
- model returns `Chat.`
- `N("Chat.")` → `"chat"` → matches `N("chat")`
- returned value is `"chat"` (declared literal)

Return type is a scalar string. No wrapper object is used.

---

## Determinism Guarantee

For a given normalized output and fixed option set, the result is deterministic.

The runtime MUST produce the same outcome for identical inputs on every execution.

---

## Failure Behavior

If validation fails:

1. The call is a contract violation.
2. `retry_on_contract_violation` applies if configured.
3. If retries are exhausted: `on_contract_violation` runs if provided, otherwise the runtime raises an error.

Recommended error shape (non-normative):

```json
{
  "type": "contract_violation",
  "subtype": "decide_mismatch",
  "expected": ["chat", "search", "other"],
  "actual": "<original model output>"
}
```

Non-contract failures (transport, timeout, provider, host adapter) propagate normally and are not decide violations.

---

## Retry Semantics

Retries MUST include corrective guidance containing:

1. Allowed values (declared options)
2. Previous invalid output
3. Instruction to return exactly one allowed value and nothing else

```nrv
intent = agent(
  "classifier",
  event.value,
  decide=["chat","search","other"],
  retry_on_contract_violation=1
)
```

---

## Model Guidance

The runtime SHOULD guide the model to:

- select exactly one value from the provided options
- return only that value

This guidance is non-binding and does not guarantee compliance. The runtime is the authority on validation.

---

## `"other"` Semantics

`"other"` is a normal literal option with no special runtime behavior.

The runtime MUST NOT implicitly map invalid outputs to `"other"`. It is used only when explicitly produced and validated.

---

## Argument Compatibility

`decide` implicitly defines the validation mode for the call. The `validate` argument is not applicable when `decide` is present.

| Combination | Status |
|---|---|
| `decide` + `returns` | `INVALID_CALL_CONFIG` |
| `decide` + `validate` | `INVALID_CALL_CONFIG` |
| `decide` + `retry_on_contract_violation` | valid |
| `decide` + `on_contract_violation` | valid |

Rationale for `decide` + `validate`: `decide` sets its own enforcement mode. There is no separate validation mode to specify. Providing `validate` alongside `decide` indicates a programming error.

---

## Provenance Semantics

A successful `decide` result is **bounded origin**.

Control flow based on a successful `decide` output is bounded control, consistent with other contract-enforced agent outputs.

---

## IR Integration (v1)

Extend existing agent call IR:

```json
{
  "type": "agent_call",
  "contract_kind": "decide",
  "decide_options": ["chat", "search", "other"],
  "normalization": "decide_v1"
}
```

No new opcode required in v1.

---

## Non-Goals (v1)

- Fuzzy matching
- Semantic similarity
- Alias or synonym tables
- Automatic fallback to `"other"`
- Multi-field decisions
- Non-literal `decide` expressions
- Structured object or array outputs

---

## Design Principles

**Deterministic validation** — exact membership after defined normalization; no fuzzy logic.

**Explicit failure** — invalid outputs surface as contract violations, never silently corrected.

**Minimal model burden** — choose one option; no JSON shape required.

**Contract consistency** — same retry and violation handling as all other contract modes.

---

## Example

```nrv
on external "user_message"

  intent = agent(
    "classifier",
    event.value,
    decide=["chat","search","other"],
    retry_on_contract_violation=1
  )

  if intent == "chat"
    emit("chat_flow", event.value)
  else if intent == "search"
    emit("search_flow", event.value)
  else
    output text "I can help with chat or search. Which one?"
  end

end
```

---

## One-Line Summary

`decide` is a scalar binding contract for `agent(...)` that constrains plain text output to a declared option set, producing a bounded scalar string through runtime-authoritative validation.

---

## Future Extensions (Non-Goals for v1)

### `try_decide` — explicit scalar binding

`decide` performs immediate implicit binding. A symmetric explicit form is a natural future extension:

```nrv
raw = agent(..., validate="none")
result = try_decide(raw, ["chat","search","other"])

if result.ok
  emit("route", result.value)
else
  emit("decide_violation", result.error)
end
```

This would mirror `try_bind` for scalar contracts:

| | Structured | Scalar |
|---|---|---|
| implicit | `returns` | `decide` |
| explicit | `try_bind` | `try_decide` |

`try_decide` is deferred to a future spec. It is not required for v1.

---

## Implementation Notes

### Normalization algorithm (decide_v1)

`N(text)` is applied to both model output and option literals:

1. Trim leading and trailing Unicode whitespace (Unicode category Z and ASCII control characters).
2. Fold ASCII `A`–`Z` to `a`–`z`. Non-ASCII characters are unchanged.
3. Define ASCII punctuation as: `! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ { | } ~`
4. Strip leading and trailing characters in that set, repeating until neither edge is a punctuation character.
5. Internal characters (whitespace, punctuation, non-ASCII) are preserved unchanged.

`N` is applied to both sides of the comparison. The same function, same order, same character definitions.

### Empty output after normalization

If `N(model_output)` is the empty string, validation fails as a normal `decide_mismatch`. No separate error type is used.

### Duplicate detection

Option literals are canonicalized at config validation time using `N`. If any two options produce the same canonical value, the runtime MUST raise `INVALID_CALL_CONFIG` before execution begins. This prevents ambiguous return-literal resolution.

### Non-contract failures

Transport errors, timeouts, provider failures, and host adapter errors propagate normally. They are not `decide_mismatch` violations.
