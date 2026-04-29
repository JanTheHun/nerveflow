## Structured Agent Return Contracts (MVP v1 Final)

---

# Purpose

Allow `agent(...)` calls to declare expected structured JSON output using lightweight return contracts.

Extends JSON output hints from:

```nrv
format="json"
```

to explicit structural contracts:

```nrv
returns={
  intent: "",
  confidence: 0
}
```

Return contracts support:

* model guidance through prompt augmentation
* structural validation of model output
* optional bounded structural repair (`coerce` mode)
* optional bounded recovery via contract-violation retries

They provide deterministic structure over probabilistic generation.

---

# Syntax

## Existing JSON format (unchanged)

```nrv
result = agent(
  "classifier",
  prompt,
  format="json"
)
```

Still valid.

---

## Return contract

```nrv
result = agent(
  "classifier",
  prompt,
  returns={
    intent: "",
    confidence: 0
  }
)
```

`returns` accepts a JSON-like object or array literal.

---

## External return contract files

Return contracts may be loaded from JSON files using ordinary value expressions:

```nrv
returns=from_json(file("contracts/triage.json"))
```

Inline and file-loaded contracts are semantically equivalent.

Note:

- `file(...)` yields text.
- Use `from_json(...)` when loading JSON contracts.
- `returns=file("...")` alone is invalid unless future runtime auto-parse support is added.

Validation note:

- File-loaded contracts follow the same root rule as inline contracts: only object or array roots are valid; scalar roots remain contract validation errors.

---

## Nested structures supported

```nrv
returns={
  intent: "",
  score: 0,
  entities: [
    {
      name: "",
      kind: ""
    }
  ]
}
```

---

# Contract Semantics

Template exemplar values serve two intentional roles.

## 1. Type witnesses

| Exemplar         | Expected Type            |
| ---------------- | ------------------------ |
| `""`             | string                   |
| `0`              | number                   |
| `true` / `false` | boolean                  |
| `[]`             | array                    |
| `{}`             | object                   |
| `null`           | nullable / unconstrained |

Example:

```json
{
  "count": 0
}
```

declares `count` is numeric.

---

## 2. Coerce repair defaults

In coerce mode, exemplar values are also used to fill missing structure.

This is intentional.

They are structural repair defaults, not semantic domain defaults.

Use:

* `coerce` when you want runtime smoothing of probabilistic gaps
* `strict` when you want full visibility into violations

---

# Arrays And Scalar Enums

Array literals have two meanings.

## 1. Collection schema

An array with zero or one exemplar element is a collection schema.

Example:

```json
[
  {
    "name": "",
    "kind": ""
  }
]
```

means:

* array of objects
* every element must match that schema

Not positional tuple syntax.

Notes:

* `[]` means array with unconstrained item structure
* `[<schema>]` means array where each item matches `<schema>`

## 2. Scalar enum constraint (string-only)

An array with two or more string literals is an enum-constrained scalar field.

Example:

```json
{
  "color": ["green", "red", "other"]
}
```

means:

* field type is string
* value must exactly match one listed literal

Not supported:

* wildcard enum entries such as `"*"`
* wildcard/pattern semantics
* regex/glob matching

Enums are exact string-literal membership only.

### Special case: "other" sentinel (optional)

When an enum includes the literal string `"other"`, hosts may treat it as an explicit fallback value during prompt augmentation.

Important:

* this does not change validation semantics
* `"other"` is validated exactly like any other enum member
* fallback prompting is opt-in and derived only from contract membership

---

## Array behavior

Valid:

```json
[]
```

Empty arrays are valid.

In coerce mode:

```json
null
```

may be treated as missing and repaired to:

```json
[]
```

Wrong non-array types remain violations.

Coerce never synthesizes missing array elements.

It may repair missing collections, but never fabricate records.

---

# Validation Modes

Optional:

```nrv
validate="strict"
```

or

```nrv
validate="coerce"
```

---

## Strict

Rules:

* output must be valid JSON
* all declared fields must be present
* additional undeclared object fields are violations
* recursive nested validation applies
* array items validated recursively
* type mismatches are violations
* no repair

Violations raise error.

---

## Coerce

Rules:

* recursive repair applies
* missing fields filled from contract
* nested objects repaired recursively
* null object fields may be treated as missing and repaired from contract
* missing arrays may repair to exemplar array
* null arrays may be treated as missing
* additional undeclared object fields are preserved
* type mismatches still fail

Coerce repairs omissions, not invalid values.

It does not reinterpret wrong values.

---

## Enum validation semantics

Strict mode:

* returned value must be exactly one allowed enum literal
* unknown values are violations

Coerce mode:

* unknown enum values are still violations
* coerce does not rewrite enum values
* coerce does not invent enum values for missing fields

Missing enum-constrained fields are violations in both modes.

---

### Example: missing nested field

Contract:

```json
{
  "meta": {
    "source":"",
    "score":0
  }
}
```

Output:

```json
{
  "meta": {
    "score":0.9
  }
}
```

Coerced:

```json
{
  "meta": {
    "source":"",
    "score":0.9
  }
}
```

---

### Example: null nested object

Output:

```json
{
  "meta": null
}
```

Coerced:

```json
{
  "meta": {
    "source":"",
    "score":0
  }
}
```

---

## Default mode

If `returns` is supplied and `validate` omitted:

```nrv
validate="coerce"
```

is the default.

Rationale:

agent outputs are probabilistic and benefit from lightweight repair.

---

# Prompt Augmentation

When `returns` is present, hosts SHOULD augment agent instructions using the contract.

Example synthesized guidance:

```text
Return only valid JSON matching this structure:

{
  "intent": "",
  "confidence": 0
}

Include all fields.
Replace example values with actual values.
Do not include commentary.
```

---

## Placement

Contract augmentation belongs in the instruction layer, not the user prompt.

Recommended behavior:

* if `instructions=` exists, append generated guidance there
* otherwise host may synthesize hidden instruction guidance

This preserves separation between domain prompt content and control-plane contract guidance.

---

# Interaction With format="json"

If both are provided:

```nrv
agent(
  ...,
  format="json",
  returns={...}
)
```

`returns` is authoritative.

Runtime normalization canonicalizes the call by ignoring redundant `format="json"` when `returns` is present.

`returns` implies JSON output mode automatically.

---

# Error Handling

Violations raise:

```text
AGENT_RETURN_CONTRACT_VIOLATION
```

Suggested metadata:

```json
{
  "path": "meta.entities[0].name",
  "expected": "string",
  "actual": "null"
}
```

Nested paths use dotted/array-index notation.

---

# Contract-Violation Retries

When `retry_on_contract_violation=N` is specified, the runtime may automatically retry the agent call if the model output violates the return contract.

Syntax:

```nrv
result = agent(
  "classifier",
  prompt,
  returns={
    intent: ["chat", "search", "other"],
    confidence: 0
  },
  retry_on_contract_violation=1
)
```

## Retry Trigger

A retry is triggered only when output validation fails, including:

* invalid JSON structure
* wrong root type
* missing required fields
* enum constraint violations
* nested contract violations

Retries do not trigger for semantically weak but contract-valid outputs.

## Retry Behavior

On violation, runtime augments the system instructions with specific error feedback:

```text
Field "intent" must be one of:
chat | search | other

You returned: "unknown"

Return exactly one valid JSON object matching the declared contract.
```

This reuses the existing contract guidance and appends violation-specific correction.

## Validation Remains Strict

Each retry is fully revalidated against the same contract. Validation is never relaxed during retries.

If all retry attempts fail, the violation is raised normally.

Retries do not suppress terminal failure.

## Early Stop

Hosts may detect and skip repeated identical violations to avoid ineffective retry loops.

Example: if field "intent" returns the same invalid value across multiple attempts, the host may stop and raise the error.

## Effectiveness

Retries are typically most effective for:

* malformed JSON
* wrong root type
* omitted fields

They may be less reliable for repeated semantic enum violations, which depend on model behavior and prompt quality.

---

# Contract Violation Routing

Agent calls may declare a violation handler to route exhausted contract failures into workflow control flow instead of terminating execution.

## Syntax

```nrv
light = agent(
  "intent",
  event.value,
  file("choose-light.md"),
  returns=from_json(file("lighting.contract.json")),
  retry_on_contract_violation=2,
  on_contract_violation=emit("contract_violation", violation)
)
```

`on_contract_violation` must be an `emit(...)` expression.

## Execution Order

1. Validate output against contract
2. If violation and retries configured: attempt bounded recovery
3. If retries exhausted: check for `on_contract_violation` handler
4. If handler declared: execute emit, continue workflow
5. If no handler: raise `AGENT_RETURN_CONTRACT_VIOLATION` normally

## Violation Payload

`violation` is an implicit variable available in the handler expression:

```json
{
  "type": "contract_violation",
  "field": "area",
  "expected": "enum(garage|other)",
  "actual": "cellar"
}
```

Field path may be nested:

```json
{
  "field": "entities[0].kind"
}
```

## Handler Example

```nrv
on "contract_violation"
  output text "Sorry, I couldn't parse that. Bad field: ${event.value.field}"
end
```

Inspect violation details using `event.value` properties.

## Semantics

Contract violations routed via handlers are **not** silently recovered.

They are failures that enter the control-flow model through events.

Handler design is the application's responsibility—a missing handler raises normally.

---

# Backward Compatibility

* `format="json"` unchanged
* `returns={...}` additive
* multi-string arrays in contracts are interpreted as scalar enums

Compatibility note:

* interpreting multi-string arrays as enums is a semantic change from first-element array-schema behavior for those forms

---

# Scope (MVP)

Included:

* agent-only support
* prompt augmentation
* recursive validation
* strict mode
* coerce mode
* runtime canonicalization of redundant format
* string scalar enums with exact-literal matching
* contract-violation retries with specific error feedback
* contract violation routing to event handlers

Explicitly out of scope:

* tool/script return contracts
* optional field syntax
* JSON Schema compatibility
* value coercion beyond structural repair
* numeric enums
* ranges
* regex/pattern constraints
* wildcard enum semantics
* provider/transport failure retries (distinct mechanism)
* exponential backoff strategies

---

# Example

```nrv
triage = agent(
  "classifier",
  event.value,
  returns={
    intent: "",
    confidence: 0
  }
)

if triage.intent == "search"
  emit("search_flow", event.value)
end
```

---

## Design Rule

Return contracts are lightweight structural contracts, not a general type system.

They validate shape, not truth.

They let deterministic workflows trust structure while smoothing probabilistic gaps.

> Trust the structure. Repair the gaps.
