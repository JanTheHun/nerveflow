# Quick Language Reference

One-page practical syntax sheet.
For full semantics and edge cases, see [03-language-reference.md](./03-language-reference.md).

## 1. Script Structure

```nrv
include "shared.nrv"

on external "user_message"
  output text "hello"
end
```

## 2. Variables And Assignment

```nrv
x = 1
name = "alice"
x += 1
```

State assignment:

```nrv
state.count = state.count + 1
```

## 3. Expressions

Literals:

```nrv
"hello"
123
true
null
[1, 2, 3]
{ category: "music" }
```

Path access:

```nrv
event.value
state.count
result.intent
```

Interpolation:

```nrv
"hello ${name}"
```

Arithmetic:

```nrv
a + b
a - b
a * b
a / b
```

Comparisons:

```nrv
a == b
a != b
a > b
a < b
a >= b
a <= b
```

Logical:

```nrv
a && b
a || b
```

Aliases also accepted:

```nrv
a & b
a | b
```

## 4. Control Flow

```nrv
if condition
  ...
else if other
  ...
else
  ...
end
```

```nrv
for i in 1..10
  ...
end
```

```nrv
stop
return value
```

## 5. Events

Internal:

```nrv
on "internal_event"
  ...
end
```

External:

```nrv
on external "user_message"
  ...
end
```

Emit:

```nrv
emit("task_complete", result)
```

## 6. Output

```nrv
output text "hello"
output json data
output console "debug"
print "hello"
```

`print` is an alias for `output text`.

## 7. Core Built-Ins

```nrv
concat(a, b, c)
length(x)
take(list, n)
find_by(list, key, value)
remove_by(list, key, value)
dedupe_by(list, key)
sort(list, key, desc=false)
cut(list, key, op, value)
pick(collection, key_or_index)
exact_length(n, schema)
```

JSON, files, and input:

```nrv
from_json(text)
to_json(value)
file("prompt.txt")
input("enter value")
```

## 8. Integration Calls

Tool:

```nrv
result = tool("search", { query: event.value })
```

Agent:

```nrv
reply = agent("chat", event.value)
```

Model:

```nrv
reply = model("llama3.2", "hello")
```

Script and operator:

```nrv
out = script("flows/child.nrv", { value: event.value })
op = operator("host_op_id", { value: event.value })
```

`try_bind(...)` is also a valid direct call target.

## 9. Agent/Model Named Arguments

Supported named args:

```nrv
messages=
format=
returns=
validate=
decide=
retry_on_contract_violation=
on_contract_violation=
```

Decide example:

```nrv
intent = agent(
  "router",
  event.value,
  decide=["chat", "search", "other"]
)
```

Returns example:

```nrv
result = agent(
  "classifier",
  event.value,
  returns={ intent: "", confidence: 0 }
)
```

Enum field in returns:

```nrv
returns={ area: ["kitchen", "garage", "other"] }
```

`decide` and `returns` are mutually exclusive on one call.

## 10. Try Envelope

Syntax:

```nrv
result = try tool("search", { q: event.value })
```

Envelope shape:

```nrv
{ ok: true, value: ... }
{ ok: false, error: { type, message, output? } }
```

`try` supports direct calls to `tool`, `agent`, `model`, `script`, `operator`, and `try_bind`.

## 11. Parallel

Syntax:

```nrv
results = parallel([
  agent("summary", text),
  model("llama3.2", text)
])
```

Rules:

1. Must be assigned.
2. Children must be direct `agent(...)` or `model(...)` calls.
3. `on_contract_violation` is not allowed inside parallel children.

## 12. Includes

```nrv
include "shared/helpers.nrv"
```

## Notes

- Standalone statements must be function calls.
- `on` blocks are top-level only and cannot be nested.
- `loop ... end` is removed in v1.
