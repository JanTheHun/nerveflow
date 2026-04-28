import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  compileAST,
  detectCycles,
  extractEventGraph,
  parseNextVScript,
  parseNextVScriptFromFile,
} from '../src/index.js'

test('extractEventGraph builds deduplicated event topology from AST input', () => {
  const ast = parseNextVScript([
    'on "first"',
    '  emit("second", event.value)',
    '  emit("third", event.value)',
    '  emit("third", event.value)',
    'end',
    'on "second"',
    '  emit("third", "done")',
    'end',
    'on "third"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast)

  // Bipartite model: event nodes + handler nodes.
  const eventNodes = graph.nodes.filter((n) => n.kind === 'event').map((n) => n.id).sort()
  const handlerNodes = graph.nodes.filter((n) => n.kind === 'handler').map((n) => n.id).sort()
  assert.deepEqual(eventNodes, ['first', 'second', 'third'])
  assert.deepEqual(handlerNodes, ['handler:first', 'handler:second', 'handler:third'])

  const subscriptionEdges = graph.edges.filter((e) => e.type === 'subscription')
    .map((e) => [e.from, e.to]).sort((a, b) => a[0].localeCompare(b[0]))
  const emitEdges = graph.edges.filter((e) => e.type === 'emit')
    .map((e) => [e.from, e.to]).sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))
  assert.deepEqual(subscriptionEdges, [
    ['first', 'handler:first'],
    ['second', 'handler:second'],
    ['third', 'handler:third'],
  ])
  assert.deepEqual(emitEdges, [
    ['handler:first', 'second'],
    ['handler:first', 'third'],
    ['handler:second', 'third'],
  ])
  assert.deepEqual(graph.transitions, [
    {
      eventType: 'first',
      subscriptionKind: 'internal',
      classification: 'pure',
      tools: [],
      outputs: [],
      warnings: [],
    },
    {
      eventType: 'second',
      subscriptionKind: 'internal',
      classification: 'pure',
      tools: [],
      outputs: [],
      warnings: [],
    },
    {
      eventType: 'third',
      subscriptionKind: 'internal',
      classification: 'pure',
      tools: [],
      outputs: [],
      warnings: [],
    },
  ])
})

test('extractEventGraph ignores dynamic emit targets and detectCycles finds simple loops', () => {
  const ast = parseNextVScript([
    'on "alpha"',
    '  emit("beta", event.value)',
    '  emit(state.target, event.value)',
    'end',
    'on "beta"',
    '  emit("alpha", event.value)',
    'end',
  ].join('\n'))
  const ir = compileAST(ast)

  const graph = extractEventGraph(ir)
  const result = detectCycles(graph)

  // Bipartite model: both event and handler nodes present.
  const eventNodeIds = graph.nodes.filter((n) => n.kind === 'event').map((n) => n.id).sort()
  assert.deepEqual(eventNodeIds, ['alpha', 'beta'])
  const emitEdges = graph.edges.filter((e) => e.type === 'emit').map((e) => [e.from, e.to]).sort((a, b) => a[0].localeCompare(b[0]))
  assert.deepEqual(emitEdges, [
    ['handler:alpha', 'beta'],
    ['handler:beta', 'alpha'],
  ])
  assert.equal(Array.isArray(result.cycles), true)
  assert.deepEqual(result.cycles, [['alpha', 'beta', 'alpha']])
})

test('extractEventGraph classifies pure, llm, side_effect, and mixed transitions', () => {
  const ast = parseNextVScript([
    'on "pure"',
    '  state.count = state.count + 1',
    'end',
    'on "llm"',
    '  response = agent("triage", event.value)',
    'end',
    'on "side"',
    '  output text "hello"',
    '  state.now = tool("get_time")',
    'end',
    'on "mixed"',
    '  response = agent("triage", event.value)',
    '  output text "notify"',
    '  state.file = tool("write_file", path="x.txt", content="hi")',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast)
  const byEvent = Object.fromEntries(graph.transitions.map((transition) => [transition.eventType, transition]))

  assert.equal(byEvent.pure.classification, 'pure')
  assert.equal(byEvent.llm.classification, 'llm')
  assert.equal(byEvent.side.classification, 'side_effect')
  assert.equal(byEvent.mixed.classification, 'mixed')
  assert.deepEqual(byEvent.side.outputs, ['text'])
  assert.deepEqual(byEvent.side.tools, [
    {
      name: 'get_time',
      effectful: false,
      categories: ['time'],
    },
  ])
  assert.deepEqual(byEvent.mixed.tools, [
    {
      name: 'write_file',
      effectful: true,
      categories: ['filesystem'],
    },
  ])
  assert.equal(byEvent.mixed.warnings.length, 1)
  assert.equal(byEvent.mixed.warnings[0].code, 'MIXED_TRANSITION')
})

test('extractEventGraph emits UNHANDLED_EMIT for internally emitted events with no handler', () => {
  const ast = parseNextVScript([
    'on "trigger"',
    '  emit("ghost", event.value)',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast)
  const codes = graph.contractWarnings.map((cw) => cw.code)
  assert.ok(codes.includes('UNHANDLED_EMIT'), `expected UNHANDLED_EMIT, got: ${codes.join(', ')}`)
  const warn = graph.contractWarnings.find((cw) => cw.eventType === 'ghost')
  assert.ok(warn, 'expected contract warning for "ghost"')
  assert.equal(warn.code, 'UNHANDLED_EMIT')
})

test('extractEventGraph emits UNDECLARED_EXTERNAL for handlers with no inbound emit and not declared', () => {
  const ast = parseNextVScript([
    'on "entry"',
    '  state.x = 1',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast)
  const codes = graph.contractWarnings.map((cw) => cw.code)
  assert.ok(codes.includes('UNDECLARED_EXTERNAL'), `expected UNDECLARED_EXTERNAL, got: ${codes.join(', ')}`)

  const graphDeclared = extractEventGraph(ast, { declaredExternals: ['entry'] })
  const codesDeclared = graphDeclared.contractWarnings.map((cw) => cw.code)
  assert.ok(!codesDeclared.includes('UNDECLARED_EXTERNAL'), 'UNDECLARED_EXTERNAL should be suppressed when declared')
})

test('extractEventGraph emits UNLISTENED_EXTERNAL for declared externals with no on external subscriber', () => {
  const ast = parseNextVScript([
    'on external "known"',
    '  state.x = 1',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['known', 'missing'] })
  const warn = graph.contractWarnings.find((cw) => cw.code === 'UNLISTENED_EXTERNAL')
  assert.ok(warn, 'expected UNLISTENED_EXTERNAL for "missing"')
  assert.equal(warn.eventType, 'missing')
  const noWarnForKnown = graph.contractWarnings.find(
    (cw) => cw.code === 'UNLISTENED_EXTERNAL' && cw.eventType === 'known'
  )
  assert.ok(!noWarnForKnown, '"known" has on external subscription, should not get UNLISTENED_EXTERNAL')
  // Orphan event node for "missing" must be present in graph even though it has no handler.
  const missingNode = graph.nodes.find((n) => n.kind === 'event' && n.id === 'missing')
  assert.ok(missingNode, 'expected orphan event node for declared external "missing" with no handler')
})

test('extractEventGraph emits DECLARED_EXTERNAL_HAS_EMITTER for externals that are also emitted internally', () => {
  const ast = parseNextVScript([
    'on "trigger"',
    '  emit("inbound", event.value)',
    'end',
    'on "inbound"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['inbound'] })
  const warn = graph.contractWarnings.find((cw) => cw.code === 'DECLARED_EXTERNAL_HAS_EMITTER')
  assert.ok(warn, 'expected DECLARED_EXTERNAL_HAS_EMITTER for "inbound"')
  assert.equal(warn.eventType, 'inbound')
})

test('extractEventGraph returns declaredExternals in result', () => {
  const ast = parseNextVScript([
    'on "entry"',
    '  state.x = 1',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['entry', 'other'] })
  assert.deepEqual(graph.declaredExternals.sort(), ['entry', 'other'])
})

test('extractEventGraph detects emit nested in arithmetic expressions', () => {
  const ast = parseNextVScript([
    'on "alpha"',
    '  state.value = emit("beta", event.value) * 2',
    'end',
    'on "beta"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast)
  const emitEdges = graph.edges.filter((edge) => edge.type === 'emit').map((edge) => [edge.from, edge.to])

  assert.deepEqual(emitEdges, [['handler:alpha', 'beta']])
})

test('extractEventGraph no contract warnings for a fully wired graph', () => {
  const ast = parseNextVScript([
    'on external "first"',
    '  emit("second", event.value)',
    'end',
    'on "second"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['first'] })
  assert.deepEqual(graph.contractWarnings, [])
})

test('extractEventGraph emits UNDECLARED_EXTERNAL_SUBSCRIPTION for on external not declared', () => {
  const ast = parseNextVScript([
    'on external "webhook"',
    '  emit("work", event.value)',
    'end',
    'on "work"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: [] })
  const warn = graph.contractWarnings.find((cw) => cw.code === 'UNDECLARED_EXTERNAL_SUBSCRIPTION')
  assert.ok(warn, 'expected UNDECLARED_EXTERNAL_SUBSCRIPTION')
  assert.equal(warn.eventType, 'webhook')
})

test('extractEventGraph emits GHOST_INTERNAL_EMIT when emit target has no internal on handler', () => {
  const ast = parseNextVScript([
    'on external "entry"',
    '  emit("ghost", event.value)',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['entry'] })
  const warn = graph.contractWarnings.find((cw) => cw.code === 'GHOST_INTERNAL_EMIT' && cw.eventType === 'ghost')
  assert.ok(warn, 'expected GHOST_INTERNAL_EMIT for ghost target')
})

test('extractEventGraph flags EXTERNAL_HANDLER_COMPLEXITY on logic in on external handler', () => {
  const ast = parseNextVScript([
    'on external "entry"',
    '  if event.value == "x"',
    '    emit("work", event.value)',
    '  end',
    'end',
    'on "work"',
    '  state.done = true',
    'end',
  ].join('\n'))

  const graph = extractEventGraph(ast, { declaredExternals: ['entry'] })
  const transition = graph.transitions.find((t) => t.eventType === 'entry')
  assert.ok(transition, 'expected transition for entry')
  const warning = transition.warnings.find((w) => w.code === 'EXTERNAL_HANDLER_COMPLEXITY')
  assert.ok(warning, 'expected EXTERNAL_HANDLER_COMPLEXITY warning')
})

test('extractEventGraph annotates nodes with sourcePath for include-expanded handlers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nextv-graph-source-'))
  try {
    const entryPath = join(dir, 'router.nrv')
    const authPath = join(dir, 'auth.nrv')
    const chatPath = join(dir, 'chat.nrv')

    writeFileSync(entryPath, [
      'include "auth.nrv"',
      'include "chat.nrv"',
    ].join('\n'), 'utf8')

    writeFileSync(authPath, [
      'on "login"',
      '  emit("route", event.value)',
      'end',
    ].join('\n'), 'utf8')

    writeFileSync(chatPath, [
      'on "route"',
      '  state.ok = true',
      'end',
    ].join('\n'), 'utf8')

    const ast = parseNextVScriptFromFile(entryPath)
    const graph = extractEventGraph(ast)

    const loginHandler = graph.nodes.find((node) => node.id === 'handler:login')
    const routeHandler = graph.nodes.find((node) => node.id === 'handler:route')
    const routeEvent = graph.nodes.find((node) => node.id === 'route' && node.kind === 'event')

    assert.ok(loginHandler, 'expected handler node for login')
    assert.ok(routeHandler, 'expected handler node for route')
    assert.ok(routeEvent, 'expected event node for route')

    assert.equal(loginHandler.sourcePath, authPath)
    assert.equal(routeHandler.sourcePath, chatPath)
    // route event node gets its location from the emit site (auth.nrv), not the subscriber
    assert.equal(routeEvent.sourcePath, authPath)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
