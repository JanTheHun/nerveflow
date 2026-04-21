import test from 'node:test'
import assert from 'node:assert/strict'
import { compileAST, parseNextVScript } from '../src/index.js'

test('compiler lowers assignment call into call opcode with dst', () => {
  const statements = parseNextVScript('x = tool("get_time")')
  const ir = compileAST(statements)

  assert.equal(ir.length, 1)
  assert.equal(ir[0].op, 'tool_call')
  assert.deepEqual(ir[0].dst, ['x'])
})

test('compiler lowers standalone call with null dst', () => {
  const statements = parseNextVScript('tool("get_time")')
  const ir = compileAST(statements)

  assert.equal(ir.length, 1)
  assert.equal(ir[0].op, 'tool_call')
  assert.equal(ir[0].dst, null)
})

test('compiler lowers operator call into operator_call opcode with dst', () => {
  const statements = parseNextVScript('x = operator("router", event.value)')
  const ir = compileAST(statements)

  assert.equal(ir.length, 1)
  assert.equal(ir[0].op, 'operator_call')
  assert.deepEqual(ir[0].dst, ['x'])
})

test('compiler lowers on block into subscribe plus jump', () => {
  const statements = parseNextVScript([
    'on "ping"',
    '  x = 1',
    'end',
  ].join('\n'))

  const ir = compileAST(statements)

  assert.equal(ir[0].op, 'subscribe')
  assert.equal(ir[0].eventType, 'ping')
  assert.equal(ir[0].subscriptionKind, 'internal')
  assert.equal(typeof ir[0].bodyStart, 'number')
  assert.equal(typeof ir[0].bodyEnd, 'number')
  assert.equal(ir[1].op, 'jump')
})

test('compiler lowers on external block with external subscription kind', () => {
  const statements = parseNextVScript([
    'on external "webhook"',
    '  emit("work", event.value)',
    'end',
  ].join('\n'))

  const ir = compileAST(statements)
  assert.equal(ir[0].op, 'subscribe')
  assert.equal(ir[0].eventType, 'webhook')
  assert.equal(ir[0].subscriptionKind, 'external')
})

test('compiler keeps emit() as generic call opcode', () => {
  const statements = parseNextVScript('emit("ping", 1)')
  const ir = compileAST(statements)

  assert.equal(ir.length, 1)
  assert.equal(ir[0].op, 'call')
  assert.equal(ir[0].name, 'emit')
  assert.equal(ir[0].dst, null)
})

test('compiler lowers if/else chain into branch and jump opcodes', () => {
  const statements = parseNextVScript([
    'if 1 == 1',
    '  x = 1',
    'else',
    '  x = 2',
    'end',
  ].join('\n'))

  const ir = compileAST(statements)
  const branch = ir.find((instr) => instr.op === 'branch')
  const jump = ir.find((instr) => instr.op === 'jump')

  assert.equal(Boolean(branch), true)
  assert.equal(Boolean(jump), true)
  assert.equal(typeof branch.ifFalse, 'number')
  assert.equal(typeof jump.target, 'number')
})

test('compiler lowers for loop with frozen end bound and back-jump', () => {
  const statements = parseNextVScript([
    'sum = 0',
    'for i in 1..3',
    'sum = sum + i',
    'end',
  ].join('\n'))

  const ir = compileAST(statements)

  assert.equal(ir.some((instr) => instr.op === 'call' && instr.name === '__nextv_for_validate_range'), true)
  assert.equal(ir.some((instr) => instr.op === 'branch'), true)
  assert.equal(ir.some((instr) => instr.op === 'jump'), true)
})

test('strict compilation rejects forbidden calls', () => {
  const statements = parseNextVScript('x = input()')

  assert.throws(
    () => compileAST(statements, {
      strict: true,
      errorFactory: (partial) => {
        const err = new Error(partial.message)
        Object.assign(err, partial)
        return err
      },
    }),
    (err) => err.code === 'STRICT_MODE_VIOLATION',
  )
})

test('strict compilation rejects forbidden calls nested in object literals', () => {
  const statements = parseNextVScript([
    'x = {',
    '  payload: from_json("{}")',
    '}',
  ].join('\n'))

  assert.throws(
    () => compileAST(statements, {
      strict: true,
      errorFactory: (partial) => {
        const err = new Error(partial.message)
        Object.assign(err, partial)
        return err
      },
    }),
    (err) => err.code === 'STRICT_MODE_VIOLATION',
  )
})
