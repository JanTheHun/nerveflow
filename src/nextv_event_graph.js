import { compileAST } from './nextv_compiler.js'
import { getToolMetadata } from './tool_metadata.js'

function walkExpr(expr, visitor) {
  if (!expr || typeof expr !== 'object') return
  visitor(expr)

  if (expr.type === 'add') {
    for (const term of expr.terms ?? []) {
      walkExpr(term, visitor)
    }
    return
  }

  if (expr.type === 'compare' || expr.type === 'logical') {
    walkExpr(expr.left, visitor)
    walkExpr(expr.right, visitor)
    return
  }

  if (expr.type === 'array') {
    for (const element of expr.elements ?? []) {
      walkExpr(element, visitor)
    }
    return
  }

  if (expr.type === 'object') {
    for (const entry of expr.entries ?? []) {
      walkExpr(entry?.valueExpr, visitor)
    }
    return
  }

  if (expr.type === 'call') {
    for (const arg of expr.args ?? []) {
      walkExpr(arg?.expr, visitor)
    }
  }
}

function normalizeToIR(astOrIR) {
  if (Array.isArray(astOrIR)) {
    if (astOrIR.every((item) => item && typeof item === 'object' && typeof item.op === 'string')) {
      return astOrIR
    }
    if (astOrIR.every((item) => item && typeof item === 'object' && typeof item.type === 'string')) {
      return compileAST(astOrIR)
    }
  }

  if (astOrIR && typeof astOrIR === 'object' && Array.isArray(astOrIR.ir)) {
    return normalizeToIR(astOrIR.ir)
  }

  throw new TypeError('extractEventGraph expects nextV AST statements or compiled IR instructions.')
}

function getLiteralEventType(args) {
  for (const arg of args ?? []) {
    if (arg?.kind !== 'positional') continue
    if (arg?.expr?.type !== 'string') return ''

    const value = String(arg.expr.value ?? '').trim()
    return value || ''
  }
  return ''
}

function collectEmitCalls(instr) {
  const calls = []
  const pushCall = (args, meta = {}) => {
    const sourcePath = String(meta.sourcePath ?? '').trim()
    const sourceLineRaw = Number(meta.sourceLine)
    calls.push({
      eventType: getLiteralEventType(args),
      line: Number.isFinite(Number(meta.line)) ? Number(meta.line) : null,
      statement: String(meta.statement ?? ''),
      sourcePath,
      sourceLine: Number.isFinite(sourceLineRaw) ? sourceLineRaw : null,
    })
  }

  if (instr?.op === 'call' && instr?.name === 'emit') {
    pushCall(instr.args, instr)
  }

  const visitExpr = (expr) => {
    walkExpr(expr, (node) => {
      if (node?.type === 'call' && node?.name === 'emit') {
        pushCall(node.args, instr)
      }
    })
  }

  if (instr?.op === 'assign') {
    visitExpr(instr.src)
  }

  if (instr?.op === 'branch') {
    visitExpr(instr.cond)
  }

  if (instr?.op === 'emit') {
    visitExpr(instr.src)
  }

  for (const arg of instr?.args ?? []) {
    visitExpr(arg?.expr)
  }

  return calls
}

function getInstructionSourceMeta(instr) {
  const sourcePath = String(instr?.sourcePath ?? '').trim()
  const sourceLineRaw = Number(instr?.sourceLine)
  const sourceLine = Number.isFinite(sourceLineRaw) ? sourceLineRaw : null
  return { sourcePath, sourceLine }
}

function getLiteralToolName(args) {
  for (const arg of args ?? []) {
    if (arg?.kind !== 'positional') continue
    if (arg?.expr?.type !== 'string') return ''

    const value = String(arg.expr.value ?? '').trim()
    return value || ''
  }
  return ''
}

function collectTransitionSignals(instr, state) {
  const visitExpr = (expr) => {
    walkExpr(expr, (node) => {
      if (node?.type !== 'call') return

      if (node.name === 'agent') {
        state.hasAgent = true
        return
      }

      if (node.name === 'tool') {
        const toolName = getLiteralToolName(node.args)
        const metadata = toolName ? getToolMetadata(toolName) : null
        state.tools.push({
          name: toolName,
          effectful: metadata?.effectful === true,
          categories: metadata?.categories ?? [],
        })
        if (metadata?.effectful === true) {
          state.hasEffect = true
        }
        return
      }
    })
  }

  if (instr?.op === 'agent_call') {
    state.hasAgent = true
  }

  if (instr?.op === 'tool_call') {
    const toolName = getLiteralToolName(instr.args)
    const metadata = toolName ? getToolMetadata(toolName) : null
    state.tools.push({
      name: toolName,
      effectful: metadata?.effectful === true,
      categories: metadata?.categories ?? [],
    })
    if (metadata?.effectful === true) {
      state.hasEffect = true
    }
  }

  if (instr?.op === 'emit') {
    state.hasEffect = true
    state.outputs.push(String(instr.format ?? 'text'))
    visitExpr(instr.src)
  }

  if (instr?.op === 'assign') {
    visitExpr(instr.src)
  }

  if (instr?.op === 'branch') {
    visitExpr(instr.cond)
  }

  for (const arg of instr?.args ?? []) {
    visitExpr(arg?.expr)
  }
}

function classifyTransitionState(state) {
  if (state.hasAgent && state.hasEffect) return 'mixed'
  if (state.hasAgent) return 'llm'
  if (state.hasEffect) return 'side_effect'
  return 'pure'
}

function isSimpleExternalHandlerInstruction(instr) {
  // Thin external handlers are expected to be emit-only wiring.
  return Boolean(instr?.op === 'call' && instr?.name === 'emit')
}

export function extractEventGraph(astOrIR, options = {}) {
  const ir = normalizeToIR(astOrIR)
  const nodes = []
  const edges = []
  const ignoredDynamicEmits = []
  const transitions = []
  const seenNodeIds = new Set()
  const nodeById = new Map()
  const seenEdgeKeys = new Set()
  const handlersSet = new Set()
  const internalHandlersSet = new Set()
  const externalHandlersSet = new Set()
  const emittedTargetsSet = new Set()
  const declaredExternals = new Set(
    Array.isArray(options.declaredExternals)
      ? options.declaredExternals.map((e) => String(e ?? '').trim()).filter(Boolean)
      : []
  )

  const toHandlerId = (eventType) => `handler:${eventType}`

  const ensureNode = (nodeObj) => {
    const existing = nodeById.get(nodeObj.id)
    if (existing) {
      if (!existing.sourcePath && nodeObj.sourcePath) {
        existing.sourcePath = nodeObj.sourcePath
      }
      if (existing.sourceLine == null && Number.isFinite(Number(nodeObj.sourceLine))) {
        existing.sourceLine = Number(nodeObj.sourceLine)
      }
      return
    }

    if (seenNodeIds.has(nodeObj.id)) return
    seenNodeIds.add(nodeObj.id)
    nodeById.set(nodeObj.id, nodeObj)
    nodes.push(nodeObj)
  }

  const ensureEdge = (from, to, type) => {
    const key = `${from}\u0000${to}`
    if (seenEdgeKeys.has(key)) return
    seenEdgeKeys.add(key)
    edges.push({ from, to, type })
  }

  const ensureEventNode = (eventType, sourceMeta = {}) => {
    const sourcePath = String(sourceMeta.sourcePath ?? '').trim()
    const sourceLineRaw = Number(sourceMeta.sourceLine)
    const sourceLine = Number.isFinite(sourceLineRaw) ? sourceLineRaw : null
    ensureNode({
      id: eventType,
      kind: 'event',
      eventType,
      ...(sourcePath ? { sourcePath } : {}),
      ...(sourceLine !== null ? { sourceLine } : {}),
    })
  }

  const ensureHandlerNode = (eventType, sourceMeta = {}) => {
    const sourcePath = String(sourceMeta.sourcePath ?? '').trim()
    const sourceLineRaw = Number(sourceMeta.sourceLine)
    const sourceLine = Number.isFinite(sourceLineRaw) ? sourceLineRaw : null
    ensureNode({
      id: toHandlerId(eventType),
      kind: 'handler',
      eventType,
      ...(sourcePath ? { sourcePath } : {}),
      ...(sourceLine !== null ? { sourceLine } : {}),
    })
  }

  for (const instr of ir) {
    if (instr?.op !== 'subscribe') continue

    const sourceEvent = String(instr.eventType ?? '').trim()
    if (!sourceEvent) continue
    const subscriptionKind = instr.subscriptionKind === 'external' ? 'external' : 'internal'
    const sourceMeta = getInstructionSourceMeta(instr)

    ensureEventNode(sourceEvent, sourceMeta)
    ensureHandlerNode(sourceEvent, sourceMeta)
    if (sourceMeta.sourcePath) {
      const eventNode = nodeById.get(sourceEvent)
      if (eventNode) {
        eventNode.sourcePath = sourceMeta.sourcePath
        if (sourceMeta.sourceLine != null) {
          eventNode.sourceLine = sourceMeta.sourceLine
        }
      }
    }
    ensureEdge(sourceEvent, toHandlerId(sourceEvent), 'subscription')
    handlersSet.add(sourceEvent)
    if (subscriptionKind === 'external') {
      externalHandlersSet.add(sourceEvent)
    } else {
      internalHandlersSet.add(sourceEvent)
    }

    const srcHandlerId = toHandlerId(sourceEvent)
    const bodyStart = Number.isInteger(instr.bodyStart) ? instr.bodyStart : 0
    const bodyEnd = Number.isInteger(instr.bodyEnd) ? Math.min(instr.bodyEnd, ir.length) : ir.length
    const transitionState = {
      hasAgent: false,
      hasEffect: false,
      tools: [],
      outputs: [],
    }
    let hasExternalComplexity = false

    for (let index = bodyStart; index < bodyEnd; index++) {
      const nestedInstr = ir[index]
      if (subscriptionKind === 'external' && !isSimpleExternalHandlerInstruction(nestedInstr)) {
        hasExternalComplexity = true
      }
      collectTransitionSignals(nestedInstr, transitionState)
      for (const emitCall of collectEmitCalls(nestedInstr)) {
        if (!emitCall.eventType) {
          ignoredDynamicEmits.push({
            from: sourceEvent,
            line: emitCall.line,
            statement: emitCall.statement,
          })
          continue
        }

        ensureEventNode(emitCall.eventType, emitCall)
        ensureEdge(srcHandlerId, emitCall.eventType, 'emit')
        emittedTargetsSet.add(emitCall.eventType)
      }
    }

    const classification = classifyTransitionState(transitionState)
    const warnings = []
    if (classification === 'mixed') {
      warnings.push({
        code: 'MIXED_TRANSITION',
        message: 'Transition mixes agent reasoning with host-visible effects.',
      })
    }
    if (subscriptionKind === 'external' && hasExternalComplexity) {
      warnings.push({
        code: 'EXTERNAL_HANDLER_COMPLEXITY',
        message: 'External handler contains logic beyond thin emit-only ingress wiring.',
      })
    }

    transitions.push({
      eventType: sourceEvent,
      subscriptionKind,
      classification,
      tools: transitionState.tools,
      outputs: transitionState.outputs,
      warnings,
    })
  }

  // Ensure event nodes exist for all declared externals (even those without handlers).
  for (const declared of declaredExternals) {
    ensureEventNode(declared)
  }

  // --- Contract warnings ---
  const contractWarnings = []

  for (const target of emittedTargetsSet) {
    if (!handlersSet.has(target)) {
      contractWarnings.push({
        code: 'UNHANDLED_EMIT',
        eventType: target,
        message: `Event "${target}" is emitted internally but has no on-handler.`,
      })
    }
    if (!internalHandlersSet.has(target)) {
      contractWarnings.push({
        code: 'GHOST_INTERNAL_EMIT',
        eventType: target,
        message: `Event "${target}" is emitted but has no internal on-handler subscription.`,
      })
    }
  }

  for (const handler of internalHandlersSet) {
    if (!emittedTargetsSet.has(handler) && !declaredExternals.has(handler)) {
      contractWarnings.push({
        code: 'UNDECLARED_EXTERNAL',
        eventType: handler,
        message: `Handler "${handler}" has no inbound emit and is not declared external in nextv.json.`,
      })
    }
  }

  for (const handler of externalHandlersSet) {
    if (!declaredExternals.has(handler)) {
      contractWarnings.push({
        code: 'UNDECLARED_EXTERNAL_SUBSCRIPTION',
        eventType: handler,
        message: `External handler "${handler}" uses on external but is not declared in nextv.json externals.`,
      })
    }
  }

  for (const declared of declaredExternals) {
    if (!externalHandlersSet.has(declared)) {
      contractWarnings.push({
        code: 'UNLISTENED_EXTERNAL',
        eventType: declared,
        message: `External event "${declared}" is declared but has no on external subscriber in this script.`,
      })
    }
    if (emittedTargetsSet.has(declared)) {
      contractWarnings.push({
        code: 'DECLARED_EXTERNAL_HAS_EMITTER',
        eventType: declared,
        message: `External event "${declared}" is declared external but is also emitted internally.`,
      })
    }
  }

  return {
    nodes,
    edges,
    transitions,
    ignoredDynamicEmits,
    contractWarnings,
    declaredExternals: Array.from(declaredExternals),
  }
}

function canonicalizeCycle(cycle) {
  const body = cycle.slice(0, -1)
  if (body.length === 0) return cycle

  let best = null
  for (let i = 0; i < body.length; i++) {
    const rotated = body.slice(i).concat(body.slice(0, i))
    const key = rotated.join('\u0000')
    if (!best || key < best.key) {
      best = { key, rotated }
    }
  }

  return best ? [...best.rotated, best.rotated[0]] : cycle
}

// Strip handler: prefix to get the underlying event type for cycle reporting.
function toEventType(nodeId) {
  const s = String(nodeId ?? '')
  return s.startsWith('handler:') ? s.slice('handler:'.length) : s
}

export function detectCycles(graph) {
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  const adjacency = new Map()

  for (const edge of edges) {
    // Accept both new { from, to, type } objects and legacy [from, to] tuples.
    let rawFrom, rawTo, edgeType
    if (Array.isArray(edge)) {
      ;[rawFrom, rawTo] = edge
      edgeType = 'emit'
    } else {
      rawFrom = edge?.from
      rawTo = edge?.to
      edgeType = edge?.type ?? 'emit'
    }
    // Only traverse emit edges for cycle detection — subscription edges create trivial 2-cycles.
    if (edgeType !== 'emit') continue

    // Collapse to event-level: handler:A → B becomes A → B.
    const source = toEventType(String(rawFrom ?? '').trim())
    const target = toEventType(String(rawTo ?? '').trim())
    if (!source || !target) continue
    if (!adjacency.has(source)) adjacency.set(source, [])
    if (!adjacency.has(target)) adjacency.set(target, [])
    const list = adjacency.get(source)
    if (!list.includes(target)) list.push(target)
  }

  for (const list of adjacency.values()) {
    list.sort((left, right) => left.localeCompare(right))
  }

  const cycles = []
  const seenCycles = new Set()
  const nodes = Array.from(adjacency.keys()).sort((left, right) => left.localeCompare(right))

  const visit = (start, current, path, inPath) => {
    const nextNodes = adjacency.get(current) ?? []

    for (const next of nextNodes) {
      if (next === start) {
        const cycle = canonicalizeCycle([...path, start])
        const key = cycle.join('\u0000')
        if (!seenCycles.has(key)) {
          seenCycles.add(key)
          cycles.push(cycle)
        }
        continue
      }

      if (inPath.has(next)) continue
      inPath.add(next)
      path.push(next)
      visit(start, next, path, inPath)
      path.pop()
      inPath.delete(next)
    }
  }

  for (const start of nodes) {
    visit(start, start, [start], new Set([start]))
  }

  cycles.sort((left, right) => left.join('>').localeCompare(right.join('>')))

  return { cycles }
}
