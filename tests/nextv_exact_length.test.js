import test from 'node:test'
import assert from 'node:assert/strict'
import { validateAgentReturnContract } from '../src/index.js'

test('exact_length() constraint validates exact array cardinality with static length', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 3,
    schema: [{ id: '', label: '' }],
  }

  const result = validateAgentReturnContract(
    [
      { id: '1', label: 'first' },
      { id: '2', label: 'second' },
      { id: '3', label: 'third' },
    ],
    constraint,
    'strict',
  )

  assert.equal(result.length, 3)
  assert.equal(result[0].id, '1')
  assert.equal(result[2].label, 'third')
})

test('exact_length() rejects arrays shorter than expected length in strict mode', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 5,
    schema: [{ id: '', name: '' }],
  }

  assert.throws(
    () => validateAgentReturnContract(
      [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
      ],
      constraint,
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.match(err.message, /array with 2 items/)
      assert.match(err.message, /array with exactly 5 items/)
      return true
    },
  )
})

test('exact_length() rejects arrays longer than expected length', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 2,
    schema: [{ id: '' }],
  }

  assert.throws(
    () => validateAgentReturnContract(
      [
        { id: '1' },
        { id: '2' },
        { id: '3' },
        { id: '4' },
      ],
      constraint,
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.match(err.message, /array with 4 items/)
      return true
    },
  )
})

test('exact_length() validates items against nested schema', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 2,
    schema: [{ id: '', level: ['urgent', 'high', 'normal'], topic: '' }],
  }

  const result = validateAgentReturnContract(
    [
      { id: '1', level: 'urgent', topic: 'security' },
      { id: '2', level: 'high', topic: 'performance' },
    ],
    constraint,
    'strict',
  )

  assert.equal(result.length, 2)
  assert.equal(result[0].level, 'urgent')
  assert.equal(result[1].topic, 'performance')
})

test('exact_length() validates items and rejects invalid enum in nested schema', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 2,
    schema: [{ id: '', level: ['urgent', 'high', 'normal'] }],
  }

  assert.throws(
    () => validateAgentReturnContract(
      [
        { id: '1', level: 'urgent' },
        { id: '2', level: 'critical' }, // Invalid enum value
      ],
      constraint,
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, '[1].level')
      return true
    },
  )
})

test('exact_length() rejects non-array values in strict mode', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 1,
    schema: [{ id: '' }],
  }

  assert.throws(
    () => validateAgentReturnContract(
      { id: '1' }, // Object, not array
      constraint,
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.match(err.message, /array/)
      return true
    },
  )
})

test('exact_length() rejects non-array values in coerce mode (no fabrication)', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 3,
    schema: [{ id: '' }],
  }

  assert.throws(
    () => validateAgentReturnContract(
      null,
      constraint,
      'coerce', // Coerce mode should still fail for cardinality
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      return true
    },
  )
})

test('exact_length() allows zero-length arrays when expected length is 0', () => {
  const constraint = {
    __nextv_constraint__: 'exact_length',
    expectedLength: 0,
    schema: [{ id: '' }],
  }

  const result = validateAgentReturnContract(
    [],
    constraint,
    'strict',
  )

  assert.deepEqual(result, [])
})

test('exact_length() in object field validates cardinality and nested items', () => {
  const contract = {
    count: 0,
    classifications: {
      __nextv_constraint__: 'exact_length',
      expectedLength: 3,
      schema: [{ id: '', level: '' }],
    },
  }

  const result = validateAgentReturnContract(
    {
      count: 3,
      classifications: [
        { id: 'a', level: 'high' },
        { id: 'b', level: 'low' },
        { id: 'c', level: 'medium' },
      ],
    },
    contract,
    'strict',
  )

  assert.equal(result.count, 3)
  assert.equal(result.classifications.length, 3)
})

test('exact_length() in nested object rejects cardinality violation on field', () => {
  const contract = {
    result: {
      classifications: {
        __nextv_constraint__: 'exact_length',
        expectedLength: 2,
        schema: [{ id: '', level: '' }],
      },
    },
  }

  assert.throws(
    () => validateAgentReturnContract(
      {
        result: {
          classifications: [{ id: 'a', level: 'high' }], // Only 1, expected 2
        },
      },
      contract,
      'strict',
    ),
    (err) => {
      assert.equal(err.code, 'AGENT_RETURN_CONTRACT_VIOLATION')
      assert.equal(err.path, 'result.classifications')
      return true
    },
  )
})
