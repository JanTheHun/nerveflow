import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  NextVError,
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  buildAgentRetryPrompt,
  compileAST,
  normalizeAgentFormattedOutput,
  parseNextVScript,
  runNextVScript,
  runNextVScriptFromFile,
  validateAgentReturnContract,
  validateOutputContract,
} from '../src/index.js'
import { createHostAdapter } from '../src/host_core/runtime_session.js'

test('supports explicit assignment and interpolation', async () => {
  const result = await runNextVScript([
    'name = "alice"',
    'greeting = "hello ${name}"',
  ].join('\n'))

  assert.equal(result.locals.name, 'alice')
  assert.equal(result.locals.greeting, 'hello alice')
})

test('interpolation rejects structured values without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'print "Result: ${response}"',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      assert.match(err.message, /to_json\(\.\.\.\)|to_json\(\)/)
      return true
    },
  )
})

test('supports state updates and arithmetic add', async () => {
  const result = await runNextVScript([
    'state.counter = state.counter + 1',
    'state.last = "done"',
  ].join('\n'), {
    state: { counter: 2 },
  })

  assert.equal(result.state.counter, 3)
  assert.equal(result.state.last, 'done')
})

test('supports subtraction multiplication division and precedence', async () => {
  const result = await runNextVScript([
    'x = 1 + 2 * 3',
    'y = (1 + 2) * 3',
    'z = 10 - 2 * 3',
    'q = 8 / 2 / 2',
  ].join('\n'))

  assert.equal(result.locals.x, 7)
  assert.equal(result.locals.y, 9)
  assert.equal(result.locals.z, 4)
  assert.equal(result.locals.q, 2)
})

test('supports state updates with multiplication and subtraction', async () => {
  const result = await runNextVScript([
    'state.counter = state.counter * 2',
    'state.counter = state.counter - 1',
  ].join('\n'), {
    state: { counter: 3 },
  })

  assert.equal(result.state.counter, 5)
})

test('arithmetic operators require numeric operands', async () => {
  await assert.rejects(
    () => runNextVScript('bad = "hello" * 2'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_ARITHMETIC_OPERAND')
      return true
    },
  )
})

test('division by zero is a runtime error', async () => {
  await assert.rejects(
    () => runNextVScript('bad = 4 / 0'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'DIVISION_BY_ZERO')
      return true
    },
  )
})

test('operator plus rejects structured values in string context', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'message = response + " suffix"',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      assert.match(err.message, /to_json\(\.\.\.\)|to_json\(\)/)
      return true
    },
  )
})

test('operator plus concatenates arrays', async () => {
  const result = await runNextVScript([
    'left = [1, 2]',
    'right = [3, 4]',
    'merged = left + right',
  ].join('\n'))

  assert.deepEqual(result.locals.merged, [1, 2, 3, 4])
})

test('operator plus supports chatbot-style message append', async () => {
  const result = await runNextVScript([
    'state.messages = [{ role: "system", content: "You are helpful." }]',
    'state.messages = state.messages + [{ role: "user", content: "hello" }]',
    'state.messages = state.messages + [{ role: "assistant", content: "hi there" }]',
  ].join('\n'), {
    state: {},
  })

  assert.equal(Array.isArray(result.state.messages), true)
  assert.equal(result.state.messages.length, 3)
  assert.equal(result.state.messages[1].role, 'user')
  assert.equal(result.state.messages[2].content, 'hi there')
})

test('operator plus rejects mixed array and text values', async () => {
  await assert.rejects(
    () => runNextVScript([
      'list = [1, 2]',
      'bad = list + "x"',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      assert.match(err.message, /Operator \+/)
      return true
    },
  )
})

test('append fails for undefined variables', async () => {
  await assert.rejects(
    () => runNextVScript('x += "1"'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'UNDEFINED_VARIABLE')
      return true
    },
  )
})

test('loop statement is rejected in vNext', async () => {
  await assert.rejects(
    () => runNextVScript('loop\nend'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'LOOP_REMOVED')
      return true
    },
  )
})

test('for loop iterates deterministically', async () => {
  const result = await runNextVScript([
    'sum = 0',
    'for i in 1..3',
    'sum = sum + i',
    'end',
  ].join('\n'))

  assert.equal(result.locals.sum, 6)
})

test('input() can read from event payload by default', async () => {
  const result = await runNextVScript([
    'message = input()',
    'state.lastMessage = message',
  ].join('\n'), {
    event: { value: 'ping' },
  })

  assert.equal(result.locals.message, 'ping')
  assert.equal(result.state.lastMessage, 'ping')
})

test('named function args are passed through', async () => {
  const calls = []
  const result = await runNextVScript('output = my_fn(a="x", b="y")', {
    functions: {
      my_fn: ({ named }) => {
        calls.push(named)
        return `${named.a}:${named.b}`
      },
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].a, 'x')
  assert.equal(calls[0].b, 'y')
  assert.equal(result.locals.output, 'x:y')
})

test('stop halts current execution', async () => {
  const result = await runNextVScript([
    'x = 1',
    'stop',
    'x = 2',
  ].join('\n'))

  assert.equal(result.stopped, true)
  assert.equal(result.locals.x, 1)
})

test('print emits output events', async () => {
  const result = await runNextVScript([
    'name = "john"',
    'print "Hello ${name}"',
  ].join('\n'))

  assert.equal(Array.isArray(result.events), true)
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'text')
  assert.equal(result.events[0].content, 'Hello john')
})

test('on block requires quoted event type', async () => {
  await assert.rejects(
    () => runNextVScript([
      'on ping',
      '  x = 1',
      'end',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_ON_SYNTAX')
      return true
    },
  )
})

test('on external block requires quoted event type', async () => {
  await assert.rejects(
    () => runNextVScript([
      'on external ping',
      '  x = 1',
      'end',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_ON_SYNTAX')
      return true
    },
  )
})

test('on external block parses and executes when signaled', async () => {
  const result = await runNextVScript([
    'on external "webhook"',
    '  emit("work", event.value)',
    'end',
    'on "work"',
    '  state.last = event.value',
    'end',
    'emit("webhook", "payload")',
  ].join('\n'), { state: {} })

  assert.equal(result.state.last, 'payload')
})

test('on external auto-dispatches initial host event without manual bridge', async () => {
  const result = await runNextVScript([
    'on external "webhook"',
    '  state.last = event.value',
    'end',
  ].join('\n'), {
    state: {},
    event: { type: 'webhook', value: 'payload' },
  })

  assert.equal(result.state.last, 'payload')
})

test('on external auto-dispatch preserves initial host payload', async () => {
  const result = await runNextVScript([
    'on external "webhook"',
    '  state.imageCount = event.payload.images_count',
    'end',
  ].join('\n'), {
    state: {},
    event: {
      type: 'webhook',
      value: '',
      payload: {
        images_count: 1,
      },
    },
  })

  assert.equal(result.state.imageCount, 1)
})

test('on external auto-dispatch does not double-fire when manual bridge already emits', async () => {
  const result = await runNextVScript([
    'state.count = 0',
    'on external "webhook"',
    '  state.count = state.count + 1',
    'end',
    'if event.type == "webhook"',
    '  emit("webhook", event.value)',
    'end',
  ].join('\n'), {
    state: {},
    event: { type: 'webhook', value: 'payload' },
  })

  assert.equal(result.state.count, 1)
})

test('auto init signal dispatches before external event processing', async () => {
  const result = await runNextVScript([
    'on "init"',
    '  emit("work", "init")',
    'end',
    'on external "webhook"',
    '  emit("work", event.value)',
    'end',
    'on "work"',
    '  state.order = state.order + event.value + ","',
    'end',
  ].join('\n'), {
    state: { order: '' },
    event: { type: 'webhook', value: 'external' },
    autoInitSignalType: 'init',
  })

  assert.equal(result.state.order, 'init,external,')
})

test('include statements compose scripts when running from file', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-include-'))
  const handlersPath = join(dir, 'handlers.nrv')
  const listenersPath = join(dir, 'listeners.nrv')
  const routerPath = join(dir, 'router.nrv')

  writeFileSync(handlersPath, [
    'on external "webhook"',
    '  emit("work", event.value)',
    'end',
  ].join('\n'), 'utf8')

  writeFileSync(listenersPath, [
    'on "work"',
    '  state.last = event.value',
    'end',
  ].join('\n'), 'utf8')

  writeFileSync(routerPath, [
    'include "handlers.nrv"',
    'include "listeners.nrv"',
  ].join('\n'), 'utf8')

  try {
    const result = await runNextVScriptFromFile(routerPath, {
      state: {},
      event: { type: 'webhook', value: 'payload' },
      declaredExternals: ['webhook'],
    })
    assert.equal(result.state.last, 'payload')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('include statement requires baseDir when parsing raw source', async () => {
  await assert.rejects(
    () => runNextVScript('include "handlers.nrv"'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INCLUDE_BASE_DIR_REQUIRED')
      return true
    },
  )
})

test('include statement detects include cycles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-include-cycle-'))
  const aPath = join(dir, 'a.nrv')
  const bPath = join(dir, 'b.nrv')

  writeFileSync(aPath, 'include "b.nrv"', 'utf8')
  writeFileSync(bPath, 'include "a.nrv"', 'utf8')

  try {
    await assert.rejects(
      () => runNextVScriptFromFile(aPath),
      (err) => {
        assert.equal(err instanceof NextVError, true)
        assert.equal(err.code, 'INCLUDE_CYCLE')
        return true
      },
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('on blocks are restricted to top-level scope', async () => {
  await assert.rejects(
    () => runNextVScript([
      'if 1 == 1',
      '  on "ping"',
      '    x = 1',
      '  end',
      'end',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'ON_NESTING_FORBIDDEN')
      return true
    },
  )
})

test('emit queues signal and runs matching handler after entrypoint', async () => {
  const result = await runNextVScript([
    'state.order = ""',
    'on "ping"',
    '  state.order = state.order + "H"',
    'end',
    'state.order = state.order + "A"',
    'emit("ping", "x")',
    'state.order = state.order + "B"',
  ].join('\n'), {
    state: {},
  })

  assert.equal(result.state.order, 'ABH')
})

test('emit payload is exposed through event.value in handlers', async () => {
  const result = await runNextVScript([
    'on "ping"',
    '  state.last = event.value',
    'end',
    'emit("ping", "hello")',
  ].join('\n'), {
    state: {},
  })

  assert.equal(result.state.last, 'hello')
})

test('multiple handlers for same event run in file order', async () => {
  const result = await runNextVScript([
    'state.trace = ""',
    'on "ping"',
    '  state.trace = state.trace + "1"',
    'end',
    'on "ping"',
    '  state.trace = state.trace + "2"',
    'end',
    'emit("ping", "")',
  ].join('\n'), {
    state: {},
  })

  assert.equal(result.state.trace, '12')
})

test('queued emits from handlers are drained sequentially', async () => {
  const result = await runNextVScript([
    'state.trace = ""',
    'on "first"',
    '  state.trace = state.trace + "A"',
    '  emit("second", "ok")',
    'end',
    'on "second"',
    '  state.trace = state.trace + "B"',
    '  state.last = event.value',
    'end',
    'emit("first", "start")',
  ].join('\n'), {
    state: {},
  })

  assert.equal(result.state.trace, 'AB')
  assert.equal(result.state.last, 'ok')
})

test('signal drain guardrail rejects excessive queued emits', async () => {
  await assert.rejects(
    () => runNextVScript([
      'on "loop"',
      '  emit("loop", "x")',
      'end',
      'emit("loop", "x")',
    ].join('\n'), {
      maxQueuedSignals: 4,
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'MAX_SIGNAL_EVENTS_EXCEEDED')
      return true
    },
  )
})

test('emit() queue emits debug signal events when trace is enabled', async () => {
  const result = await runNextVScript([
    'on "ping"',
    '  state.last = event.value',
    'end',
    'emit("ping", "hello")',
  ].join('\n'), {
    state: {},
    emitTrace: true,
  })

  const enqueueEvent = result.events.find((event) => event.type === 'signal_enqueue')
  const dispatchEvent = result.events.find((event) => event.type === 'signal_dispatch')

  assert.equal(Boolean(enqueueEvent), true)
  assert.equal(Boolean(dispatchEvent), true)
  assert.equal(enqueueEvent.signalType, 'ping')
  assert.equal(dispatchEvent.signalType, 'ping')
  assert.equal(dispatchEvent.handlers, 1)
})

test('emit() queue signal events are trace-gated', async () => {
  const result = await runNextVScript([
    'on "ping"',
    '  state.last = event.value',
    'end',
    'emit("ping", "hello")',
  ].join('\n'), {
    state: {},
  })

  assert.equal(result.events.some((event) => event.type === 'signal_enqueue'), false)
  assert.equal(result.events.some((event) => event.type === 'signal_dispatch'), false)
})

test('emit() warns when used in operator role', async () => {
  const result = await runNextVScript('emit("notify_request", event.value)', {
    event: { value: 'ping' },
    executionRole: 'operator',
  })

  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].type, 'warning')
  assert.equal(result.warnings[0].code, 'ROLE_EMIT_DISCOURAGED')
  assert.equal(result.warnings[0].executionRole, 'operator')
  assert.match(result.warnings[0].message, /operators should not own global orchestration/i)
})

test('output warns when used in script role', async () => {
  const result = await runNextVScript('output text "Hello"', {
    executionRole: 'script',
  })

  assert.equal(result.warnings.length, 1)
  assert.equal(result.warnings[0].type, 'warning')
  assert.equal(result.warnings[0].code, 'ROLE_OUTPUT_DISCOURAGED')
  assert.equal(result.warnings[0].executionRole, 'script')
  assert.equal(result.events.some((event) => event.type === 'output'), true)
})

test('concat rejects structured values without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'message = concat("Result: ", response)',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      return true
    },
  )
})

test('to_json serializes structured values for text output', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\",\\"score\\":0.9}"',
    'response = from_json(raw)',
    'text = to_json(response)',
    'print text',
  ].join('\n'))

  const outputEvent = result.events.find((event) => event.type === 'output')

  assert.equal(result.locals.text.includes('"intent": "chat"'), true)
  assert.equal(result.locals.text.includes('"score": 0.9'), true)
  assert.equal(Boolean(outputEvent), true)
  assert.equal(outputEvent.content.includes('"intent": "chat"'), true)
})

test('function calls emit tool events except input', async () => {
  const result = await runNextVScript([
    'state.when = now()'
  ].join('\n'), {
    functions: {
      now: () => '2026-04-12T00:00:00.000Z',
    },
  })

  assert.equal(result.events.length, 2)
  assert.equal(result.events[0].type, 'tool_call')
  assert.equal(result.events[0].tool, 'now')
  assert.equal(result.events[1].type, 'tool_result')
  assert.equal(result.events[1].tool, 'now')
  assert.equal(result.events[1].result, '2026-04-12T00:00:00.000Z')
})

test('state update events are debug-gated', async () => {
  const withoutDebug = await runNextVScript('state.count = state.count + 1', {
    state: { count: 0 },
  })
  const withDebug = await runNextVScript('state.count = state.count + 1', {
    state: { count: 0 },
    emitStateUpdates: true,
  })

  assert.equal(withoutDebug.events.some((event) => event.type === 'state_update'), false)
  assert.equal(withDebug.events.some((event) => event.type === 'state_update'), true)
})

test('output statement emits text events', async () => {
  const result = await runNextVScript('output text "Hello"')

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'text')
  assert.equal(result.events[0].channel, 'text')
  assert.equal(result.events[0].content, 'Hello')
  assert.equal(result.events[0].payload, 'Hello')
})

test('output event includes effectChannelId when declared effect matches channel', async () => {
  const result = await runNextVScript('output text "Hello"', {
    effectChannels: {
      text: {
        format: 'text',
      },
    },
  })

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'text')
  assert.equal(result.events[0].channel, 'text')
  assert.equal(result.events[0].effectChannelId, 'text')
})

test('output accepts declared custom effect channel and preserves channel identity', async () => {
  const result = await runNextVScript('output heartbeat "tick"', {
    effectChannels: {
      heartbeat: {
        format: 'text',
      },
    },
  })

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].channel, 'heartbeat')
  assert.equal(result.events[0].format, 'text')
  assert.equal(result.events[0].effectChannelId, 'heartbeat')
  assert.equal(result.events[0].content, 'tick')
})

test('declared custom output channel defaults to json formatting when format is omitted', async () => {
  const result = await runNextVScript('output heartbeat { ok: true }', {
    effectChannels: {
      heartbeat: {
        kind: 'mqtt',
      },
    },
  })

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].channel, 'heartbeat')
  assert.equal(result.events[0].format, 'json')
  assert.equal(result.events[0].effectChannelId, 'heartbeat')
  assert.equal(result.events[0].value.ok, true)
  assert.equal(typeof result.events[0].content, 'string')
})

test('output console emits console format events', async () => {
  const result = await runNextVScript('output console "Hello console"')

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'console')
  assert.equal(result.events[0].content, 'Hello console')
})

test('print is an alias of output text', async () => {
  const printResult = await runNextVScript('print "alias check"')
  const outputResult = await runNextVScript('output text "alias check"')

  assert.equal(printResult.events.length, 1)
  assert.equal(outputResult.events.length, 1)
  assert.equal(printResult.events[0].type, outputResult.events[0].type)
  assert.equal(printResult.events[0].format, outputResult.events[0].format)
  assert.equal(printResult.events[0].content, outputResult.events[0].content)
})

test('output voice emits voice format events', async () => {
  const result = await runNextVScript('output voice "hello voice"')

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'voice')
  assert.equal(result.events[0].content, 'hello voice')
})

test('output visual emits visual format events', async () => {
  const result = await runNextVScript('output visual "<h1>Hello visual</h1>"')

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'visual')
  assert.equal(result.events[0].content, '<h1>Hello visual</h1>')
})

test('output interaction emits interaction format events', async () => {
  const result = await runNextVScript('output interaction "Need a reply"')

  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].type, 'output')
  assert.equal(result.events[0].format, 'interaction')
  assert.equal(result.events[0].content.includes('Need a reply'), true)
  assert.equal(result.events[0].value, 'Need a reply')
})

test('output interaction supports structured payload via from_json', async () => {
  const result = await runNextVScript([
    'payload = from_json("{\\"prompt\\":\\"Approve this item?\\",\\"correlationId\\":\\"abc-123\\",\\"replyEventType\\":\\"interaction_reply\\"}")',
    'output interaction payload',
  ].join('\n'))

  const outputEvent = result.events.find((event) => event.type === 'output' && event.format === 'interaction')
  assert.equal(Boolean(outputEvent), true)
  assert.equal(outputEvent.value.prompt, 'Approve this item?')
  assert.equal(outputEvent.value.correlationId, 'abc-123')
  assert.equal(typeof outputEvent.content, 'string')
  assert.equal(outputEvent.content.includes('"correlationId": "abc-123"'), true)
})

test('from_json parses agent-style JSON and supports dotted access in conditions', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\",\\"meta\\":{\\"topic\\":\\"support\\"}}"',
    'response = from_json(raw)',
    'intent = response.intent',
    'if response.intent',
    '  print "intent=${intent} topic=${response.meta.topic}"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.intent, 'chat')
  assert.equal(result.events.some((event) => event.type === 'output' && event.content.includes('intent=chat')), true)
})

test('from_json output can be used for numeric loop bounds', async () => {
  const result = await runNextVScript([
    'raw = "{\\"count\\":3}"',
    'response = from_json(raw)',
    'sum = 0',
    'for i in 1..response.count',
    'sum = sum + i',
    'end',
  ].join('\n'))

  assert.equal(result.locals.sum, 6)
})

test('length() returns size for arrays strings and objects', async () => {
  const result = await runNextVScript([
    'items = from_json("[{\\"id\\":1},{\\"id\\":2},{\\"id\\":3}]")',
    'arr_len = length(items)',
    'text_len = length("hello")',
    'obj_len = length({ a: 1, b: 2 })',
  ].join('\n'))

  assert.equal(result.locals.arr_len, 3)
  assert.equal(result.locals.text_len, 5)
  assert.equal(result.locals.obj_len, 2)
})

test('take() returns first n entries and handles non-positive values', async () => {
  const result = await runNextVScript([
    'items = from_json("[{\\"id\\":1},{\\"id\\":2},{\\"id\\":3}]")',
    'head = take(items, 2)',
    'none = take(items, 0)',
  ].join('\n'))

  assert.deepEqual(result.locals.head, [{ id: 1 }, { id: 2 }])
  assert.deepEqual(result.locals.none, [])
})

test('find_by() returns first matching object and null when missing', async () => {
  const result = await runNextVScript([
    'items = from_json("[{\\"id\\":1,\\"title\\":\\"A\\"},{\\"id\\":2,\\"title\\":\\"B\\"},{\\"id\\":2,\\"title\\":\\"B2\\"}]")',
    'found = find_by(items, "id", 2)',
    'missing = find_by(items, "id", 9)',
  ].join('\n'))

  assert.deepEqual(result.locals.found, { id: 2, title: 'B' })
  assert.equal(result.locals.missing, null)
})

test('remove_by() removes all matching rows and keeps order', async () => {
  const result = await runNextVScript([
    'items = from_json("[{\\"id\\":1},{\\"id\\":2},{\\"id\\":1},{\\"id\\":3}]")',
    'filtered = remove_by(items, "id", 1)',
  ].join('\n'))

  assert.deepEqual(result.locals.filtered, [{ id: 2 }, { id: 3 }])
})

test('dedupe_by() keeps first occurrence for each key value', async () => {
  const result = await runNextVScript([
    'items = from_json("[{\\"id\\":1,\\"title\\":\\"first\\"},{\\"id\\":2,\\"title\\":\\"alpha\\"},{\\"id\\":1,\\"title\\":\\"second\\"}]")',
    'deduped = dedupe_by(items, "id")',
  ].join('\n'))

  assert.deepEqual(result.locals.deduped, [
    { id: 1, title: 'first' },
    { id: 2, title: 'alpha' },
  ])
})

test('collection helpers reject invalid arguments', async () => {
  await assert.rejects(
    () => runNextVScript('x = take("oops", 1)'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_COLLECTION_ARGUMENT')
      return true
    },
  )

  await assert.rejects(
    () => runNextVScript('x = dedupe_by(from_json("[{\\"id\\":1}]"), "")'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_COLLECTION_ARGUMENT')
      return true
    },
  )
})

test('from_json throws JSON_PARSE_ERROR for invalid json', async () => {
  await assert.rejects(
    () => runNextVScript('response = from_json("not-json")'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'JSON_PARSE_ERROR')
      return true
    },
  )
})

test('output json emits structured value payload', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\",\\"score\\":0.9}"',
    'response = from_json(raw)',
    'output json response',
  ].join('\n'))

  const outputEvent = result.events.find((event) => event.type === 'output' && event.format === 'json')
  assert.equal(Boolean(outputEvent), true)
  assert.equal(outputEvent.value.intent, 'chat')
  assert.equal(outputEvent.value.score, 0.9)
  assert.equal(typeof outputEvent.content, 'string')
  assert.equal(outputEvent.content.includes('"intent": "chat"'), true)
})

test('output json accepts object literals directly', async () => {
  const result = await runNextVScript([
    'output json {',
    '  status: "ready",',
    '  data: {',
    '    count: 1,',
    '    tags: ["notify", "demo"]',
    '  }',
    '}',
  ].join('\n'))

  const outputEvent = result.events.find((event) => event.type === 'output' && event.format === 'json')
  assert.equal(Boolean(outputEvent), true)
  assert.deepEqual(outputEvent.value, {
    status: 'ready',
    data: {
      count: 1,
      tags: ['notify', 'demo'],
    },
  })
})

test('output text rejects structured values without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'output text response',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      return true
    },
  )
})

test('output visual rejects structured values without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "[{\\"intent\\":\\"chat\\"}]"',
      'response = from_json(raw)',
      'output visual response',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      return true
    },
  )
})

test('output rejects unsupported format', async () => {
  await assert.rejects(
    () => runNextVScript('output html "hello"'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_OUTPUT_FORMAT')
      return true
    },
  )
})

test('tool() delegates to runtime tool hook', async () => {
  const calls = []
  const result = await runNextVScript('state.now = tool("get_time")', {
    callTool: async ({ name, args }) => {
      calls.push({ name, args })
      return '2026-04-12T12:00:00.000Z'
    },
    state: {},
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'get_time')
  assert.equal(result.state.now, '2026-04-12T12:00:00.000Z')
  assert.equal(result.events[0].type, 'tool_call')
  assert.equal(result.events[0].tool, 'get_time')
  assert.equal(result.events[1].type, 'tool_result')
  assert.equal(result.events[1].tool, 'get_time')
})

test('tool() emits concrete tool metadata when provided by runtime', async () => {
  const result = await runNextVScript('state.now = tool("get_time")', {
    getToolMetadata: (name) => name === 'get_time'
      ? { effectful: false, categories: ['time'], needsConfirmation: false }
      : null,
    callTool: async () => '2026-04-12T12:00:00.000Z',
    state: {},
  })

  const toolCallEvent = result.events.find((event) => event.type === 'tool_call')
  const toolResultEvent = result.events.find((event) => event.type === 'tool_result')

  assert.equal(Boolean(toolCallEvent), true)
  assert.equal(Boolean(toolResultEvent), true)
  assert.deepEqual(toolCallEvent.toolMetadata, {
    effectful: false,
    categories: ['time'],
    needsConfirmation: false,
  })
  assert.deepEqual(toolResultEvent.toolMetadata, {
    effectful: false,
    categories: ['time'],
    needsConfirmation: false,
  })
})

test('tool() can use hostAdapter callTool fallback', async () => {
  const calls = []
  const result = await runNextVScript('state.now = tool("get_time")', {
    hostAdapter: {
      callTool: async ({ name }) => {
        calls.push(name)
        return '2026-04-13T09:00:00.000Z'
      },
    },
    state: {},
  })

  assert.deepEqual(calls, ['get_time'])
  assert.equal(result.state.now, '2026-04-13T09:00:00.000Z')
})

test('direct callTool hook overrides hostAdapter fallback', async () => {
  const result = await runNextVScript('state.now = tool("get_time")', {
    callTool: async () => 'direct-hook',
    hostAdapter: {
      callTool: async () => 'adapter-hook',
    },
    state: {},
  })

  assert.equal(result.state.now, 'direct-hook')
})

test('tool() surfaces hostAdapter policy errors', async () => {
  await assert.rejects(
    () => runNextVScript('state.now = tool("blocked_tool")', {
      hostAdapter: {
        callTool: async () => {
          throw new Error('Tool "blocked_tool" is not allowed by workspace tools policy.')
        },
      },
      state: {},
    }),
    (err) => {
      assert.equal(err instanceof Error, true)
      assert.match(err.message, /not allowed by workspace tools policy/)
      return true
    },
  )
})

test('agent() delegates to runtime agent hook', async () => {
  const calls = []
  const result = await runNextVScript('summary = agent("research", "summarize this")', {
    callAgent: async ({ agent, prompt, instructions, format }) => {
      calls.push({ agent, prompt, instructions, format })
      return 'short summary'
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].agent, 'research')
  assert.equal(calls[0].prompt, 'summarize this')
  assert.equal(calls[0].instructions, '')
  assert.equal(calls[0].format, '')
  assert.equal(result.locals.summary, 'short summary')
})

test('agent() can use hostAdapter callAgent fallback', async () => {
  const calls = []
  const result = await runNextVScript('summary = agent("research", "summarize this")', {
    hostAdapter: {
      callAgent: async ({ agent }) => {
        calls.push(agent)
        return 'adapter summary'
      },
    },
  })

  assert.deepEqual(calls, ['research'])
  assert.equal(result.locals.summary, 'adapter summary')
})

test('agent() supports named format json and structured dotted access', async () => {
  const calls = []
  const result = await runNextVScript([
    'response = agent("intent-classifier", event.value, format="json")',
    'if response.intent',
    '  print "intent=${response.intent} topic=${response.meta.topic}"',
    'end',
  ].join('\n'), {
    event: { value: 'help me reset my password' },
    callAgent: async ({ agent, prompt, format }) => {
      calls.push({ agent, prompt, format })
      return normalizeAgentFormattedOutput('```json\n{"intent":"support","meta":{"topic":"password"}}\n```', format)
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].agent, 'intent-classifier')
  assert.equal(calls[0].prompt, 'help me reset my password')
  assert.equal(calls[0].format, 'json')
  assert.equal(result.locals.response.intent, 'support')
  assert.equal(result.events.some((event) => event.type === 'output' && event.content.includes('intent=support topic=password')), true)
})

test('agent() supports explicit messages array', async () => {
  const calls = []
  const result = await runNextVScript([
    'history = [',
    '  { role: "system", content: "You are concise." },',
    '  { role: "user", content: "hello" },',
    '  { role: "assistant", content: "hi" },',
    '  { role: "user", content: "what can you do?" }',
    ']',
    'answer = agent("chat", messages=history)',
  ].join('\n'), {
    callAgent: async ({ agent, prompt, messages }) => {
      calls.push({ agent, prompt, messages })
      return 'I can help with local automation.'
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].agent, 'chat')
  assert.equal(calls[0].prompt, '')
  assert.equal(Array.isArray(calls[0].messages), true)
  assert.equal(calls[0].messages.length, 4)
  assert.equal(calls[0].messages[3].content, 'what can you do?')
  assert.equal(result.locals.answer, 'I can help with local automation.')
})

test('agent() rejects invalid messages payload', async () => {
  await assert.rejects(
    () => runNextVScript('answer = agent("chat", messages="not-an-array")', {
      callAgent: async () => 'unused',
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_MESSAGES')
      return true
    },
  )
})

test('agent() passes per-message images in messages array', async () => {
  const calls = []
  await runNextVScript([
    'history = [',
    '  { role: "user", content: "what is this?", images: ["aGVsbG8=", "d29ybGQ="] },',
    '  { role: "assistant", content: "a cat" }',
    ']',
    'answer = agent("visual", messages=history)',
  ].join('\n'), {
    callAgent: async ({ messages }) => {
      calls.push({ messages })
      return 'a cat'
    },
  })

  assert.equal(calls.length, 1)
  const userMsg = calls[0].messages[0]
  assert.deepStrictEqual(userMsg.images, ['aGVsbG8=', 'd29ybGQ='])
  const assistantMsg = calls[0].messages[1]
  assert.equal(Object.hasOwn(assistantMsg, 'images'), false)
})

test('agent() filters empty strings from per-message images', async () => {
  const calls = []
  await runNextVScript([
    'history = [',
    '  { role: "user", content: "look", images: ["  ", "aGVsbG8=", ""] }',
    ']',
    'answer = agent("visual", messages=history)',
  ].join('\n'), {
    callAgent: async ({ messages }) => {
      calls.push({ messages })
      return 'ok'
    },
  })

  assert.equal(calls.length, 1)
  assert.deepStrictEqual(calls[0].messages[0].images, ['aGVsbG8='])
})

test('agent() omits images field when per-message images array is all empty', async () => {
  const calls = []
  await runNextVScript([
    'history = [',
    '  { role: "user", content: "look", images: ["  ", ""] }',
    ']',
    'answer = agent("visual", messages=history)',
  ].join('\n'), {
    callAgent: async ({ messages }) => {
      calls.push({ messages })
      return 'ok'
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(Object.hasOwn(calls[0].messages[0], 'images'), false)
})

test('agent() rejects non-array images on message entry', async () => {
  await assert.rejects(
    () => runNextVScript([
      'history = [',
      '  { role: "user", content: "look", images: "aGVsbG8=" }',
      ']',
      'answer = agent("visual", messages=history)',
    ].join('\n'), {
      callAgent: async () => 'unused',
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_MESSAGES')
      assert.match(err.message, /images must be an array/)
      return true
    },
  )
})

test('agent() preserves positional instructions when named format is used', async () => {
  const calls = []
  const result = await runNextVScript('summary = agent("research", "Summarize this", "be concise", format="text")', {
    callAgent: async ({ instructions, format }) => {
      calls.push({ instructions, format })
      return normalizeAgentFormattedOutput('Sure, **Brief summary**', format)
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].instructions, 'be concise')
  assert.equal(calls[0].format, 'text')
  assert.equal(result.locals.summary, 'Brief summary')
})

test('agent() rejects structured prompt values without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'summary = agent("research", response)',
    ].join('\n'), {
      callAgent: async () => 'unused',
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      assert.match(err.message, /agent\(\) prompt/)
      return true
    },
  )
})

test('agent() rejects structured instructions without to_json', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'instructions_obj = from_json(raw)',
      'summary = agent("research", "Summarize this", instructions_obj)',
    ].join('\n'), {
      callAgent: async () => 'unused',
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRUCTURED_STRING_COERCION')
      assert.match(err.message, /agent\(\) instructions/)
      return true
    },
  )
})

test('agent() rejects unsupported named format values', async () => {
  await assert.rejects(
    () => runNextVScript('summary = agent("research", "summarize this", format="html")'),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_FORMAT')
      return true
    },
  )
})

test('agent() passes returns contract and defaults validate to coerce', async () => {
  const calls = []
  await runNextVScript([
    'result = agent("classifier", "route this", returns={ intent: "", confidence: 0 })',
  ].join('\n'), {
    callAgent: async ({ returns, validate, format }) => {
      calls.push({ returns, validate, format })
      return { intent: 'search', confidence: 0.9 }
    },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].returns, { intent: '', confidence: 0 })
  assert.equal(calls[0].validate, 'coerce')
  assert.equal(calls[0].format, '')
})

test('agent() preserves explicit validate mode with returns contract', async () => {
  const calls = []
  await runNextVScript('result = agent("classifier", "route this", returns={ intent: "" }, validate="strict")', {
    callAgent: async ({ validate }) => {
      calls.push({ validate })
      return { intent: 'search' }
    },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].validate, 'strict')
})

test('agent() rejects invalid validate mode', async () => {
  await assert.rejects(
    () => runNextVScript('result = agent("classifier", "route this", returns={ intent: "" }, validate="smart")', {
      callAgent: async () => ({ intent: 'search' }),
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_VALIDATE')
      return true
    },
  )
})

test('agent() rejects unsupported named arguments such as validation', async () => {
  await assert.rejects(
    () => runNextVScript('result = agent("classifier", "route this", returns={ intent: "" }, validation="strict")', {
      callAgent: async () => ({ intent: 'search' }),
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_ARGUMENT')
      assert.match(err.message, /validation/)
      return true
    },
  )
})

test('agent() rejects non-object non-array returns contract', async () => {
  await assert.rejects(
    () => runNextVScript('result = agent("classifier", "route this", returns=42)', {
      callAgent: async () => ({ intent: 'search' }),
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'INVALID_AGENT_RETURNS')
      return true
    },
  )
})

test('agent() returns contract works end-to-end via hostAdapter path', async () => {
  const calls = []
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { classifier: { model: 'llama3', instructions: 'profile baseline' } } },
      operators: { map: {} },
    },
    callAgent: async ({ messages }) => {
      calls.push(messages)
      return '{"intent":"search"}'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract,
    buildAgentReturnContractGuidance,
  })

  const result = await runNextVScript([
    'triage = agent("classifier", event.value, returns={ intent: "", confidence: 0 })',
    'state.intent = triage.intent',
    'state.confidence = triage.confidence',
  ].join('\n'), {
    hostAdapter: adapter,
    event: { type: 'user_input', value: 'route this' },
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0][0].role, 'system')
  assert.match(calls[0][0].content, /Return only valid JSON matching this structure/)
  assert.equal(calls[0][1].role, 'user')
  assert.equal(calls[0][1].content, 'route this')
  assert.equal(result.state.intent, 'search')
  assert.equal(result.state.confidence, 0)
})

test('agent() returns strict mode surfaces contract violation metadata via hostAdapter path', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { classifier: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => '{"intent":null,"confidence":0.9}',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract,
    buildAgentReturnContractGuidance,
  })

  await assert.rejects(
    () => runNextVScript(
      'triage = agent("classifier", event.value, returns={ intent: "", confidence: 0 }, validate="strict")',
      {
        hostAdapter: adapter,
        event: { type: 'user_input', value: 'route this' },
      },
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'intent')
      assert.equal(err.expected, 'string')
      assert.equal(err.actual, 'null')
      assert.equal(err.agent, 'classifier')
      assert.equal(Number.isFinite(Number(err.line)), true)
      assert.match(String(err.message ?? ''), /agent\("classifier"\)/)
      return true
    },
  )
})

test('agent() exhausted contract retries are reflected in final error message', async () => {
  let callCount = 0
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { classifier: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => {
      callCount += 1
      return '{"intent":[]}'
    },
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract,
    buildAgentReturnContractGuidance,
    buildAgentRetryPrompt,
  })

  await assert.rejects(
    () => runNextVScript(
      'triage = agent("classifier", event.value, returns={ intent: ["play", "other"] }, validate="strict", retry_on_contract_violation=1)',
      {
        hostAdapter: adapter,
        event: { type: 'user_input', value: 'play music' },
      },
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.retryCount, 1)
      assert.equal(err.attempts, 2)
      assert.match(String(err.message ?? ''), /after 1 retry/i)
      return true
    },
  )

  assert.equal(callCount, 2)
})

test('agent() contract violation prefers source line/path from include-expanded scripts', async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'nextv-source-line-'))
  const entryPath = join(tmpDir, 'entry.nrv')
  const includePath = join(tmpDir, 'intent.nrv')

  writeFileSync(entryPath, 'include "intent.nrv"\n', 'utf8')
  writeFileSync(includePath, [
    'decision = agent("classifier", event.value, returns={ intent: ["play", "other"] }, validate="strict")',
  ].join('\n'), 'utf8')

  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { classifier: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => '{"intent":[]}',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract,
    buildAgentReturnContractGuidance,
  })

  try {
    await assert.rejects(
      () => runNextVScriptFromFile(entryPath, {
        hostAdapter: adapter,
        event: { type: 'user_input', value: 'play music' },
      }),
      (err) => {
        assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
        assert.equal(err.sourceLine, 1)
        assert.equal(err.line, 1)
        assert.match(String(err.sourcePath ?? ''), /intent\.nrv$/)
        return true
      },
    )
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('agent() on_contract_violation can emit violation payload without eager evaluation', async () => {
  const adapter = createHostAdapter({
    workspaceDir: { absolutePath: '/workspace', relativePath: '.' },
    workspaceConfig: {
      tools: { allow: null, aliases: {} },
      agents: { profiles: { classifier: { model: 'llama3' } } },
      operators: { map: {} },
    },
    callAgent: async () => '{"intent":"search"}',
    defaultModel: 'test-model',
    resolvePathFromBaseDirectory: (baseDir, pathRaw) => ({ absolutePath: `${baseDir}/${pathRaw}`, relativePath: pathRaw }),
    existsSync: () => false,
    runNextVScriptFromFile: async () => ({ returnValue: undefined }),
    validateOutputContract: () => {},
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    validateAgentReturnContract: () => {
      const err = new Error('violation')
      err.code = 'AGENT_RETURN_CONTRACT_VIOLATION'
      err.path = 'confidence'
      err.expected = 'number'
      err.actual = 'undefined'
      throw err
    },
    buildAgentReturnContractGuidance,
  })

  const result = await runNextVScript([
    'on "contract_violation"',
    '  state.violation_field = event.value.field',
    '  state.violation_source_type = event.value.source_event.type',
    'end',
    'decision = agent(',
    '  "classifier",',
    '  event.value,',
    '  returns={ intent: "", confidence: 0 },',
    '  validate="strict",',
    '  retry_on_contract_violation=0,',
    '  on_contract_violation=emit("contract_violation", violation)',
    ')',
    'if decision == null',
    '  state.contract_failed = true',
    'end',
  ].join('\n'), {
    hostAdapter: adapter,
    event: { type: 'user_input', value: 'route this' },
    state: {},
  })

  assert.equal(result.state.contract_failed, true)
  assert.equal(result.state.violation_field, 'confidence')
  assert.equal(result.state.violation_source_type, 'user_input')
})

test('if supports equality comparison with json intent field', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\"}"',
    'intent_result = from_json(raw)',
    'if intent_result.intent == "chat"',
    '  route = "general"',
    'else',
    '  route = "other"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'general')
})

test('if supports inequality comparison', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\"}"',
    'intent_result = from_json(raw)',
    'if intent_result.intent != "chat"',
    '  route = "other"',
    'else',
    '  route = "general"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'general')
})

test('if supports single else if branch', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"action_request\\"}"',
    'intent_result = from_json(raw)',
    'if intent_result.intent == "chat"',
    '  route = "chat"',
    'else if intent_result.intent == "action_request"',
    '  route = "action"',
    'else',
    '  route = "fallback"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'action')
})

test('if supports repeatable else if branches', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"feedback\\"}"',
    'intent_result = from_json(raw)',
    'if intent_result.intent == "chat"',
    '  route = "chat"',
    'else if intent_result.intent == "action_request"',
    '  route = "action"',
    'else if intent_result.intent == "feedback"',
    '  route = "feedback"',
    'else',
    '  route = "fallback"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'feedback')
})

test('if supports logical && and || operators', async () => {
  const result = await runNextVScript([
    'a = "yes"',
    'b = "yes"',
    'if a == "yes" && b == "yes"',
    '  route = "both"',
    'else if a == "yes" || b == "yes"',
    '  route = "one"',
    'else',
    '  route = "none"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'both')
})

test('if supports logical aliases & and |', async () => {
  const result = await runNextVScript([
    'a = "yes"',
    'b = "no"',
    'if a == "yes" & b == "yes"',
    '  route = "both"',
    'else if a == "yes" | b == "yes"',
    '  route = "one"',
    'else',
    '  route = "none"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'one')
})

test('if treats missing dotted path as falsy for existence checks', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\"}"',
    'response = from_json(raw)',
    'if response.missing_field',
    '  route = "present"',
    'else',
    '  route = "missing"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'missing')
})

test('nested if without local else does not fall into enclosing else', async () => {
  const result = await runNextVScript([
    'outer = ""',
    'inner = ""',
    'if 1 == 1',
    '  outer = "then"',
    '  if 1 == 2',
    '    inner = "unexpected"',
    '  end',
    'else',
    '  outer = "else"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.outer, 'then')
  assert.equal(result.locals.inner, '')
})

test('if can fall back with logical OR when left path is missing', async () => {
  const result = await runNextVScript([
    'raw = "{\\"intent\\":\\"chat\\"}"',
    'response = from_json(raw)',
    'if response.missing_field || response.intent == "chat"',
    '  route = "chat"',
    'else',
    '  route = "other"',
    'end',
  ].join('\n'))

  assert.equal(result.locals.route, 'chat')
})

test('missing dotted path outside condition still raises runtime error', async () => {
  await assert.rejects(
    () => runNextVScript([
      'raw = "{\\"intent\\":\\"chat\\"}"',
      'response = from_json(raw)',
      'x = response.missing_field',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'UNDEFINED_VARIABLE')
      return true
    },
  )
})

test('else if after else is rejected', async () => {
  await assert.rejects(
    () => runNextVScript([
      'if 1 == 1',
      '  route = "first"',
      'else',
      '  route = "second"',
      'else if 1 == 1',
      '  route = "third"',
      'end',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'ELSE_IF_AFTER_ELSE')
      return true
    },
  )
})

test('else if without if is rejected', async () => {
  await assert.rejects(
    () => runNextVScript([
      'else if 1 == 1',
      '  route = "nope"',
      'end',
    ].join('\n')),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'UNMATCHED_ELSE_IF')
      return true
    },
  )
})

test('script() delegates to runtime script hook and propagates state', async () => {
  const result = await runNextVScript([
    'state.counter = 1',
    'x = script("child.wfs")',
  ].join('\n'), {
    state: {},
    callScript: async ({ path, state }) => {
      assert.equal(path, 'child.wfs')
      return {
        state: {
          ...state,
          counter: Number(state.counter ?? 0) + 10,
        },
      }
    },
  })

  assert.equal(result.locals.x, null)
  assert.equal(result.state.counter, 11)
})

test('script() can use hostAdapter callScript fallback', async () => {
  const result = await runNextVScript('x = script("child.wfs")', {
    hostAdapter: {
      callScript: async ({ state }) => ({
        state: {
          ...state,
          viaAdapter: true,
        },
      }),
    },
    state: {},
  })

  assert.equal(result.locals.x, null)
  assert.equal(result.state.viaAdapter, true)
})

test('input() can use hostAdapter requestInput fallback', async () => {
  const result = await runNextVScript('answer = input("prompt")', {
    hostAdapter: {
      requestInput: async () => 'adapter-input',
    },
  })

  assert.equal(result.locals.answer, 'adapter-input')
  assert.equal(result.events.some((event) => event.type === 'input' && event.source === 'request_input'), true)
})

test('hostAdapter onEvent fallback receives emitted runtime events', async () => {
  const seen = []

  await runNextVScript('output text "hello"', {
    hostAdapter: {
      onEvent: async (eventRecord) => {
        seen.push(eventRecord.type)
      },
    },
  })

  assert.deepEqual(seen, ['output'])
})

test('script() can execute a child script file via hook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-child-'))
  const childPath = join(dir, 'child.wfs')
  writeFileSync(childPath, [
    'state.counter = state.counter + 1',
    'output text "child"',
  ].join('\n'), 'utf8')

  try {
    const result = await runNextVScript('script("child.wfs")', {
      state: { counter: 5 },
      callScript: async ({ onEvent }) => {
        return await runNextVScript([
          'state.counter = state.counter + 1',
          'output text "child"',
        ].join('\n'), {
          state: { counter: 5 },
          onEvent,
        })
      },
    })

    assert.equal(result.state.counter, 6)
    assert.equal(result.events.some((event) => event.type === 'output' && event.content === 'child'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('operator() delegates to resolveOperatorPath and callScript with scoped state', async () => {
  const calls = []
  const result = await runNextVScript([
    'state.music.counter = 1',
    'state.news.counter = 9',
    'state.output = operator("music", event.value)',
  ].join('\n'), {
    event: { value: 'ping' },
    state: {},
    resolveOperatorPath: async (operatorId) => {
      calls.push({ type: 'resolve', operatorId })
      return `operators/${operatorId}/main.wfs`
    },
    callScript: async ({ path, state, event }) => {
      calls.push({ type: 'script', path, state, event })
      return {
        state: {
          ...state,
          counter: Number(state.counter ?? 0) + 1,
          lastEvent: event,
        },
      }
    },
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0], { type: 'resolve', operatorId: 'music' })
  assert.equal(calls[1].type, 'script')
  assert.equal(calls[1].path, 'operators/music/main.wfs')
  assert.deepEqual(calls[1].state, { counter: 1 })
  assert.equal(calls[1].event, 'ping')

  assert.equal(result.state.music.counter, 2)
  assert.equal(result.state.music.lastEvent, 'ping')
  assert.equal(result.state.news.counter, 9)
  assert.equal(result.state.output, null)
})

test('operator() can use hostAdapter resolveOperatorPath fallback', async () => {
  const result = await runNextVScript('state.result = operator("music", "x")', {
    state: {},
    hostAdapter: {
      resolveOperatorPath: async () => 'operators/music/main.wfs',
      callScript: async ({ path, state }) => ({
        state: {
          ...state,
          ok: true,
        },
      }),
    },
  })

  assert.equal(result.state.result, null)
  assert.equal(result.state.music.ok, true)
})

test('operator() rejects hosts without resolveOperatorPath support', async () => {
  await assert.rejects(
    () => runNextVScript('state.result = operator("music", "x")', {
      state: {},
      callScript: async () => ({ returnValue: 'unused', state: {} }),
    }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'NOT_SUPPORTED')
      return true
    },
  )
})

test('execution result exposes compiled IR', async () => {
  const result = await runNextVScript('x = tool("clock")', {
    callTool: async () => 'ok',
  })

  assert.equal(Array.isArray(result.ir), true)
  assert.equal(result.ir.length > 0, true)
  assert.equal(result.ir[0].op, 'tool_call')
  assert.deepEqual(result.ir[0].dst, ['x'])
})

test('trace events include source metadata and optional snapshots', async () => {
  const result = await runNextVScript('x = 1', {
    emitTrace: true,
    emitTraceState: true,
  })

  const traceBefore = result.events.find((event) => event.type === 'trace' && event.phase === 'before')
  const traceAfter = result.events.find((event) => event.type === 'trace' && event.phase === 'after')

  assert.equal(Boolean(traceBefore), true)
  assert.equal(Boolean(traceAfter), true)
  assert.equal(typeof traceBefore.line, 'number')
  assert.equal(typeof traceBefore.statement, 'string')
  assert.equal(traceBefore.executionRole, 'router')
  assert.equal(Boolean(traceBefore.snapshot?.state), true)
  assert.equal(Boolean(traceBefore.snapshot?.locals), true)
})

test('execution role is exposed on result and propagated to nested script and operator calls', async () => {
  const nestedRoles = []

  const result = await runNextVScript([
    'script("flows/enrich.nrv")',
    'decision = operator("triage", event.value)',
  ].join('\n'), {
    event: { value: 'ping' },
    resolveOperatorPath: async () => 'operators/triage/main.nrv',
    callScript: async ({ path, executionRole }) => {
      nestedRoles.push({ path, executionRole })
      if (executionRole === 'operator') {
        return {
          state: {},
          returnValue: { status: 'ready', action: '', data: {}, intent: 'ignore' },
        }
      }
      return {
        state: {},
      }
    },
  })

  assert.equal(result.executionRole, 'router')
  assert.deepEqual(nestedRoles, [
    { path: 'flows/enrich.nrv', executionRole: 'script' },
    { path: 'operators/triage/main.nrv', executionRole: 'operator' },
  ])
})

test('unified call tracing emits trace_call for both expression and opcode calls', async () => {
  const result = await runNextVScript([
    'x = "" + now()',
    'now()',
  ].join('\n'), {
    emitTrace: true,
    functions: {
      now: () => '2026-01-01T00:00:00.000Z',
    },
  })

  const expressionTrace = result.events.find((event) => event.type === 'trace_call' && event.origin === 'expression' && event.phase === 'before')
  const opcodeTrace = result.events.find((event) => event.type === 'trace_call' && event.origin === 'opcode' && event.phase === 'before')

  assert.equal(Boolean(expressionTrace), true)
  assert.equal(Boolean(opcodeTrace), true)
  assert.equal(expressionTrace.name, 'now')
  assert.equal(opcodeTrace.name, 'now')
})

test('strict mode rejects input() at compile time', async () => {
  await assert.rejects(
    () => runNextVScript('x = input()', { strict: true }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRICT_MODE_VIOLATION')
      return true
    },
  )
})

test('strict mode rejects from_json() nested in expressions', async () => {
  await assert.rejects(
    () => runNextVScript('x = concat("a", from_json("{}"))', { strict: true }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRICT_MODE_VIOLATION')
      return true
    },
  )
})

test('strict mode rejects from_json() nested in object literals', async () => {
  await assert.rejects(
    () => runNextVScript([
      'payload = {',
      '  nested: from_json("{}")',
      '}',
    ].join('\n'), { strict: true }),
    (err) => {
      assert.equal(err instanceof NextVError, true)
      assert.equal(err.code, 'STRICT_MODE_VIOLATION')
      return true
    },
  )
})

test('AST mutations after compilation do not affect IR execution', async () => {
  const statements = parseNextVScript('x = 1')
  const ir = compileAST(statements)
  statements[0].valueExpr = { type: 'number', value: 999 }

  const result = await runNextVScript('x = 1')
  assert.equal(result.locals.x, 1)
  assert.equal(ir[0].op, 'assign')
  assert.equal(ir[0].src.value, 1)
})

// --- return statement and output contract ---

test('return captures returnValue in result', async () => {
  const result = await runNextVScript([
    'contract = from_json("{\\"status\\":\\"ready\\",\\"action\\":null,\\"data\\":{}}")',
    'return contract',
  ].join('\n'))

  assert.deepEqual(result.returnValue, { status: 'ready', action: null, data: {} })
})

test('return supports multiline object literals directly', async () => {
  const result = await runNextVScript([
    'return {',
    '  status: "ready",',
    '  action: "",',
    '  data: {',
    '    count: 1,',
    '    tags: ["notify", "demo"]',
    '  },',
    '  message: "No notification sent"',
    '}',
  ].join('\n'))

  assert.deepEqual(result.returnValue, {
    status: 'ready',
    action: '',
    data: {
      count: 1,
      tags: ['notify', 'demo'],
    },
    message: 'No notification sent',
  })
})

test('return halts execution and returnValue is set', async () => {
  const result = await runNextVScript([
    'state.before = 1',
    'contract = from_json("{\\"status\\":\\"ready\\",\\"action\\":null,\\"data\\":{}}")',
    'return contract',
    'state.after = 2',
  ].join('\n'))

  assert.equal(result.state.before, 1)
  assert.equal(result.state.after, undefined)
  assert.deepEqual(result.returnValue, { status: 'ready', action: null, data: {} })
})

test('returnValue is undefined when no return statement used', async () => {
  const result = await runNextVScript('x = 1')
  assert.equal(result.returnValue, undefined)
})

test('script() validates returnValue against output contract', async () => {
  await assert.rejects(
    () => runNextVScript('result = script("child.wfs")', {
      callScript: async () => ({ returnValue: 'not an object', state: {} }),
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
      return true
    },
  )
})

test('script() validates returnValue with missing status field', async () => {
  await assert.rejects(
    () => runNextVScript('result = script("child.wfs")', {
      callScript: async () => ({ returnValue: { action: null, data: {} }, state: {} }),
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
      assert.match(err.message, /status/)
      return true
    },
  )
})

test('script() validates returnValue with invalid status value', async () => {
  await assert.rejects(
    () => runNextVScript('result = script("child.wfs")', {
      callScript: async () => ({ returnValue: { status: 'unknown', action: null, data: {} }, state: {} }),
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
      assert.match(err.message, /status/)
      return true
    },
  )
})

test('script() validates returnValue with status=error missing error field', async () => {
  await assert.rejects(
    () => runNextVScript('result = script("child.wfs")', {
      callScript: async () => ({ returnValue: { status: 'error', action: null, data: {} }, state: {} }),
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
      assert.match(err.message, /error/)
      return true
    },
  )
})

test('script() passes valid contract through verbatim', async () => {
  const contract = { status: 'ready', action: 'next', data: { n: 1 } }
  const result = await runNextVScript('result = script("child.wfs")', {
    callScript: async () => ({ returnValue: contract, state: {} }),
  })
  assert.deepEqual(result.locals.result, contract)
})

test('operator() validates returnValue against output contract', async () => {
  await assert.rejects(
    () => runNextVScript('result = operator("calc", "x")', {
      resolveOperatorPath: async () => 'operators/calc/main.wfs',
      callScript: async () => ({ returnValue: { status: 'bad_value' }, state: {} }),
    }),
    (err) => {
      assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
      return true
    },
  )
})

test('operator() passes valid contract through verbatim', async () => {
  const contract = { status: 'ready', action: 'routed', data: { result: 42 } }
  const result = await runNextVScript('result = operator("calc", "x")', {
    resolveOperatorPath: async () => 'operators/calc/main.wfs',
    callScript: async () => ({ returnValue: contract, state: {} }),
  })
  assert.deepEqual(result.locals.result, contract)
  assert.equal(result.ir[0].op, 'operator_call')
  assert.deepEqual(result.ir[0].dst, ['result'])
})

test('validateOutputContract passes valid ready contract', () => {
  assert.doesNotThrow(() => validateOutputContract({ status: 'ready', action: null, data: {} }))
})

test('validateOutputContract passes contract with action string', () => {
  assert.doesNotThrow(() => validateOutputContract({ status: 'ready', action: 'next', data: {} }))
})

test('validateOutputContract passes valid error contract', () => {
  assert.doesNotThrow(() => validateOutputContract({ status: 'error', error: { code: 'FAIL', message: 'x' } }))
})

test('validateOutputContract rejects null', () => {
  assert.throws(() => validateOutputContract(null), (err) => {
    assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
    return true
  })
})

test('validateOutputContract rejects array', () => {
  assert.throws(() => validateOutputContract([]), (err) => {
    assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
    return true
  })
})

test('validateOutputContract rejects missing status', () => {
  assert.throws(() => validateOutputContract({ action: null }), (err) => {
    assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
    assert.match(err.message, /status/)
    return true
  })
})

test('validateOutputContract rejects invalid action type', () => {
  assert.throws(() => validateOutputContract({ status: 'ready', action: 42 }), (err) => {
    assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
    assert.match(err.message, /action/)
    return true
  })
})

test('validateOutputContract rejects error status without error field', () => {
  assert.throws(() => validateOutputContract({ status: 'error' }), (err) => {
    assert.equal(err.code, 'INVALID_OUTPUT_CONTRACT')
    assert.match(err.message, /error/)
    return true
  })
})

