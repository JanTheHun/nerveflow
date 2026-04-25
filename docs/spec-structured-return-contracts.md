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

# Arrays

Array contracts use the first element as the per-item schema.

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
* type mismatches still fail

Coerce repairs omissions, not invalid values.

It does not reinterpret wrong values.

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

# Backward Compatibility

* `format="json"` unchanged
* `returns={...}` additive
* no breaking changes

---

# Scope (MVP)

Included:

* agent-only support
* prompt augmentation
* recursive validation
* strict mode
* coerce mode
* runtime canonicalization of redundant format

Explicitly out of scope:

* retries
* tool/script return contracts
* optional field syntax
* JSON Schema compatibility
* value coercion beyond structural repair

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
