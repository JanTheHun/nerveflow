import { compileAST } from './nextv_compiler.js'
import { getToolMetadata } from './tool_metadata.js'

// Built-in platform output channels — declaring output on these is structural, not a host side effect.
// Custom channels (e.g. play_music) are host-specific effects and classify as side_effect.
const BUILTIN_OUTPUT_CHANNELS = new Set(['text', 'json', 'voice', 'console', 'visual', 'interaction'])

const PROVENANCE_BOUNDED = 'bounded'
const PROVENANCE_UNBOUNDED = 'unbounded'
const PROVENANCE_MIXED = 'mixed'
const PROVENANCE_UNKNOWN = 'unknown'

function pathToKey(path) {
  if (!Array.isArray(path) || path.length === 0) return ''
  return path.map((segment) => String(segment ?? '').trim()).filter(Boolean).join('.')
}

function hasContractLikeNamedArg(args) {
  for (const arg of args ?? []) {
    if (arg?.kind !== 'named') continue
    const name = String(arg.name ?? '').trim()
    if (name === 'returns' || name === 'contract') return true
  }
  return false
}

function mergeProvenanceLabels(left, right) {
  if (!left) return right || null
  if (!right) return left
  if (left === right) return left
  if (left === PROVENANCE_UNKNOWN || right === PROVENANCE_UNKNOWN) return PROVENANCE_UNKNOWN
  if (left === PROVENANCE_MIXED || right === PROVENANCE_MIXED) return PROVENANCE_MIXED
  return PROVENANCE_MIXED
}

function resolvePathProvenance(path, labelsByPath) {
  const pathKey = pathToKey(path)
  if (!pathKey) return PROVENANCE_UNKNOWN
  if (labelsByPath.has(pathKey)) return labelsByPath.get(pathKey)

  const parts = pathKey.split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    const parent = parts.slice(0, i).join('.')
    if (labelsByPath.has(parent)) return labelsByPath.get(parent)
  }
  return PROVENANCE_UNKNOWN
}

function inferExprProvenance(expr, labelsByPath) {
  if (!expr || typeof expr !== 'object') return null

  if (expr.type === 'path') {
    return resolvePathProvenance(expr.path, labelsByPath)
  }

  if (expr.type === 'call') {
    if (expr.name === 'agent') {
      return hasContractLikeNamedArg(expr.args) ? PROVENANCE_BOUNDED : PROVENANCE_UNBOUNDED
    }

    let merged = null
    for (const arg of expr.args ?? []) {
      merged = mergeProvenanceLabels(merged, inferExprProvenance(arg?.expr, labelsByPath))
    }
    return merged || PROVENANCE_UNKNOWN
  }

  let merged = null
  walkExpr(expr, (node) => {
    if (!node || node === expr) return
    if (node.type !== 'path') return
    merged = mergeProvenanceLabels(merged, resolvePathProvenance(node.path, labelsByPath))
  })

  return merged || null
}

function collectHandlerControlEdges(ir, bodyStart, bodyEnd, eventType) {
  const labelsByPath = new Map()
  const controlEdges = []

  const setPathLabel = (path, label) => {
    if (!label) return
    const key = pathToKey(path)
    if (!key) return
    labelsByPath.set(key, label)
  }

  for (let index = bodyStart; index < bodyEnd; index++) {
    const instr = ir[index]
    if (!instr || typeof instr !== 'object') continue

    if (instr.op === 'agent_call') {
      const provenance = hasContractLikeNamedArg(instr.args)
        ? PROVENANCE_BOUNDED
        : PROVENANCE_UNBOUNDED
      setPathLabel(instr.dst, provenance)
      continue
    }

    if (instr.op === 'assign') {
      const provenance = inferExprProvenance(instr.src, labelsByPath) || PROVENANCE_UNKNOWN
      setPathLabel(instr.dst, provenance)
      continue
    }

    if (instr.op === 'branch') {
      const provenance = inferExprProvenance(instr.cond, labelsByPath) || PROVENANCE_UNKNOWN
      const sourcePath = String(instr.sourcePath ?? '').trim()
      const sourceLineRaw = Number(instr.sourceLine)
      const sourceLine = Number.isFinite(sourceLineRaw) ? sourceLineRaw : null

      controlEdges.push({
        eventType,
        from: `handler:${eventType}`,
        to: `branch:${eventType}:${index}:if_true`,
        type: 'control',
        branch: 'if_true',
        provenance,
        boundedControl: provenance === PROVENANCE_BOUNDED,
        line: Number.isFinite(Number(instr.line)) ? Number(instr.line) : null,
        statement: String(instr.statement ?? ''),
        ...(sourcePath ? { sourcePath } : {}),
        ...(sourceLine !== null ? { sourceLine } : {}),
      })

      controlEdges.push({
        eventType,
        from: `handler:${eventType}`,
        to: `branch:${eventType}:${index}:if_false`,
        type: 'control',
        branch: 'if_false',
        provenance,
        boundedControl: provenance === PROVENANCE_BOUNDED,
        line: Number.isFinite(Number(instr.line)) ? Number(instr.line) : null,
        statement: String(instr.statement ?? ''),
        ...(sourcePath ? { sourcePath } : {}),
        ...(sourceLine !== null ? { sourceLine } : {}),
      })
    }
  }

  return controlEdges
}

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

  if (expr.type === 'binary') {
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

function getLiteralAgentName(args) {
  for (const arg of args ?? []) {
    if (arg?.kind !== 'positional') continue
    if (arg?.expr?.type !== 'string') return ''

    const value = String(arg.expr.value ?? '').trim()
    return value || ''
  }
  return ''
}

function collectTransitionSignals(instr, state) {
  const pushAgentName = (nameRaw) => {
    const name = String(nameRaw ?? '').trim()
    if (!name) return
    if (!state.agents.includes(name)) {
      state.agents.push(name)
    }
  }

  const visitExpr = (expr) => {
    walkExpr(expr, (node) => {
      if (node?.type !== 'call') return

      if (node.name === 'agent') {
        state.hasAgent = true
        pushAgentName(getLiteralAgentName(node.args))
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
    pushAgentName(getLiteralAgentName(instr.args))
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
    const format = String(instr.format ?? 'text').trim()
    if (BUILTIN_OUTPUT_CHANNELS.has(format)) {
      state.hasDeclaredOutput = true
    } else {
      state.hasEffect = true
    }
    state.outputs.push(format)
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
  if (state.hasDeclaredOutput) return 'declared_output'
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
  const controlEdges = []
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

    ensureEventNode(sourceEvent)
    ensureHandlerNode(sourceEvent, sourceMeta)
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
      hasDeclaredOutput: false,
      agents: [],
      tools: [],
      outputs: [],
    }
    let hasExternalComplexity = false

    for (const edge of collectHandlerControlEdges(ir, bodyStart, bodyEnd, sourceEvent)) {
      controlEdges.push(edge)
    }

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
      ...(transitionState.agents.length > 0 ? { agents: transitionState.agents } : {}),
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
    controlEdges,
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
