import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NextVEventRunner } from '../src/index.js'

function createScript(source) {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-runner-test-'))
  const scriptPath = join(dir, 'main.wfs')
  writeFileSync(scriptPath, source, 'utf8')
  return { dir, scriptPath }
}

test('runner processes events sequentially and persists state', async () => {
  const { dir, scriptPath } = createScript([
    'message = input()',
    'state.counter = state.counter + 1',
    'state.lastMessage = message',
  ].join('\n'))

  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
    })

    runner.start()
    runner.enqueue({ value: 'first' })
    runner.enqueue({ value: 'second' })
    await runner.waitForIdle()
    runner.stop()

    const snapshot = runner.getSnapshot()
    assert.equal(snapshot.state.counter, 2)
    assert.equal(snapshot.state.lastMessage, 'second')
    assert.equal(snapshot.executionCount, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner can start with an initial event', async () => {
  const { dir, scriptPath } = createScript([
    'message = input()',
    'state.last = message',
  ].join('\n'))

  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: {},
    })

    runner.start({ initialEvent: { value: 'boot' } })
    await runner.waitForIdle()
    runner.stop()

    const snapshot = runner.getSnapshot()
    assert.equal(snapshot.state.last, 'boot')
    assert.equal(snapshot.executionCount, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('stopOnScriptStop halts the runtime loop', async () => {
  const { dir, scriptPath } = createScript([
    'state.counter = state.counter + 1',
    'stop',
  ].join('\n'))

  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
      stopOnScriptStop: true,
    })

    runner.start()
    const firstAccepted = runner.enqueue({ value: 'a' })
    await runner.waitForIdle()
    const secondAccepted = runner.enqueue({ value: 'b' })

    const snapshot = runner.getSnapshot()
    assert.equal(firstAccepted, true)
    assert.equal(secondAccepted, false)
    assert.equal(snapshot.state.counter, 1)
    assert.equal(snapshot.running, false)
    assert.equal(snapshot.executionCount, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner reports errors and halts by default', async () => {
  const { dir, scriptPath } = createScript([
    'state.counter = state.counter + missing',
  ].join('\n'))

  const errors = []
  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
      onError: (err) => errors.push(err),
    })

    runner.start()
    runner.enqueue({ value: 'x' })
    await runner.waitForIdle()

    const snapshot = runner.getSnapshot()
    assert.equal(errors.length, 1)
    assert.equal(snapshot.running, false)
    assert.equal(snapshot.executionCount, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner can continue after errors when haltOnError=false', async () => {
  const { dir, scriptPath } = createScript([
    'if event.kind',
    'state.counter = state.counter + missing',
    'else',
    'state.counter = state.counter + 1',
    'end',
  ].join('\n'))

  const errors = []
  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
      haltOnError: false,
      onError: (err) => errors.push(err),
    })

    runner.start()
    runner.enqueue({ kind: 'bad' })
    await runner.waitForIdle()
    runner.enqueue({ kind: '' })
    await runner.waitForIdle()
    runner.stop()

    const snapshot = runner.getSnapshot()
    assert.equal(errors.length, 1)
    assert.equal(snapshot.state.counter, 1)
    assert.equal(snapshot.executionCount, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner saves state to state.json by default', async () => {
  const { dir, scriptPath } = createScript([
    'state.counter = state.counter + 1',
  ].join('\n'))

  try {
    const statePath = join(dir, 'state.json')
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
    })

    runner.start()
    runner.enqueue({ value: 'tick' })
    await runner.waitForIdle()
    runner.stop()

    assert.equal(existsSync(statePath), true)
    const persisted = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(persisted.counter, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner reloads persisted state before each execution', async () => {
  const { dir, scriptPath } = createScript([
    'state.counter = state.counter + 1',
  ].join('\n'))

  try {
    const statePath = join(dir, 'state.json')
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 10 },
      statePath,
    })

    runner.start()
    runner.enqueue({ value: 'a' })
    await runner.waitForIdle()

    // Simulate external writer mutating state between events.
    writeFileSync(statePath, `${JSON.stringify({ counter: 100 })}\n`, 'utf8')

    runner.enqueue({ value: 'b' })
    await runner.waitForIdle()
    runner.stop()

    const snapshot = runner.getSnapshot()
    assert.equal(snapshot.state.counter, 101)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner forwards runtime events through execution callback', async () => {
  const { dir, scriptPath } = createScript([
    'print "hello"',
    'state.counter = state.counter + 1',
  ].join('\n'))

  const executions = []
  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { counter: 0 },
      onExecution: (payload) => executions.push(payload),
    })

    runner.start({ initialEvent: { value: 'boot' } })
    await runner.waitForIdle()
    runner.stop()

    assert.equal(executions.length, 1)
    assert.equal(Array.isArray(executions[0].events), true)
    assert.equal(executions[0].events.some((event) => event.type === 'output'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner dispatches output events to matching output handler', async () => {
  const { dir, scriptPath } = createScript('output text "hello"')

  const calls = []
  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      outputHandlers: {
        text: ({ output }) => {
          calls.push(output)
        },
      },
    })

    runner.start({ initialEvent: { value: 'boot' } })
    await runner.waitForIdle()
    runner.stop()

    assert.equal(calls.length, 1)
    assert.equal(calls[0].type, 'output')
    assert.equal(calls[0].format, 'text')
    assert.equal(calls[0].content, 'hello')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner uses text handler as fallback for console output', async () => {
  const { dir, scriptPath } = createScript('output console "hello console"')

  const calls = []
  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      outputHandlers: {
        text: ({ output }) => {
          calls.push(output)
        },
      },
    })

    runner.start({ initialEvent: { value: 'boot' } })
    await runner.waitForIdle()
    runner.stop()

    assert.equal(calls.length, 1)
    assert.equal(calls[0].format, 'console')
    assert.equal(calls[0].content, 'hello console')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runner emits startup init signal once before first external event', async () => {
  const { dir, scriptPath } = createScript([
    'on "init"',
    '  state.order = state.order + "I"',
    'end',
    'on external "tick"',
    '  state.order = state.order + "E"',
    'end',
  ].join('\n'))

  try {
    const runner = new NextVEventRunner({
      entrypointPath: scriptPath,
      initialState: { order: '' },
    })

    runner.start()
    runner.enqueue({ type: 'tick', value: '1' })
    runner.enqueue({ type: 'tick', value: '2' })
    await runner.waitForIdle()
    runner.stop()

    const snapshot = runner.getSnapshot()
    assert.equal(snapshot.state.order, 'IEE')
    assert.equal(snapshot.executionCount, 2)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
