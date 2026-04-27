import test from 'node:test'
import assert from 'node:assert/strict'
import { runNextVScript } from '../src/index.js'

test('exact_length() intrinsic creates constraint schema with static numeric length', async () => {
  const result = await runNextVScript(
    'result = exact_length(5, [{id: "", name: ""}])\nreturn result',
  )

  assert.equal(result.returnValue.__nextv_constraint__, 'exact_length')
  assert.equal(result.returnValue.expectedLength, 5)
  assert.deepEqual(result.returnValue.schema, [{ id: '', name: '' }])
})

test('exact_length() requires integer length argument', async () => {
  await assert.rejects(
    () => runNextVScript('result = exact_length(5.5, [{id: ""}])'),
    (err) => {
      assert.match(err.message, /integer/)
      return true
    },
  )
})

test('exact_length() requires schema as second argument', async () => {
  await assert.rejects(
    () => runNextVScript('result = exact_length(5)'),
    (err) => {
      assert.match(err.message, /schema/)
      return true
    },
  )
})

test('exact_length() supports dynamic length via length() expression', async () => {
  const items = [1, 2, 3, 4]
  const result = await runNextVScript(
    'items = from_json("[1,2,3,4]")\nconstraint = exact_length(length(items), [{id: ""}])\nreturn constraint',
  )

  assert.equal(result.returnValue.expectedLength, 4)
  assert.equal(result.returnValue.__nextv_constraint__, 'exact_length')
})

test('exact_length() with state variable reference works in expression', async () => {
  const result = await runNextVScript(
    'state.expected_articles = 10\nconstraint = exact_length(state.expected_articles, [{id: "", title: ""}])\nreturn constraint',
    { state: { expected_articles: 10 } },
  )

  assert.equal(result.returnValue.expectedLength, 10)
  assert.equal(result.returnValue.__nextv_constraint__, 'exact_length')
})
