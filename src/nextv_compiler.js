const FORBIDDEN_STRICT_CALLS = new Set(['input', 'from_json'])

function defaultErrorFactory(partial) {
  const err = new Error(partial?.message ?? 'nextV compiler error')
  Object.assign(err, partial)
  return err
}

function makeCallInstruction(callExpr, line, statement, dst) {
  const base = {
    args: callExpr.args,
    dst: Array.isArray(dst) ? [...dst] : null,
    line,
    statement,
  }

  if (callExpr.name === 'tool') {
    return { op: 'tool_call', ...base }
  }
  if (callExpr.name === 'agent') {
    return { op: 'agent_call', ...base }
  }
  if (callExpr.name === 'script') {
    return { op: 'script_call', ...base }
  }
  if (callExpr.name === 'operator') {
    return { op: 'operator_call', ...base }
  }

  return {
    op: 'call',
    name: callExpr.name,
    ...base,
  }
}

function withSourceMeta(instruction, stmt) {
  if (!stmt || typeof stmt !== 'object') return instruction

  const sourcePath = String(stmt.sourcePath ?? '').trim()
  const sourceLine = Number(stmt.sourceLine)

  if (!sourcePath && !Number.isFinite(sourceLine)) {
    return instruction
  }

  const withMeta = { ...instruction }
  if (sourcePath) withMeta.sourcePath = sourcePath
  if (Number.isFinite(sourceLine)) withMeta.sourceLine = sourceLine
  return withMeta
}

function forContinueCondition(variable, endExpr) {
  return {
    type: 'compare',
    operator: '<=',
    left: {
      type: 'path',
      path: [variable],
    },
    right: endExpr,
  }
}

function forEndSlotName(statementIndex) {
  return `__nextv_for_end_${statementIndex}`
}

function forIncrementExpr(variable) {
  return {
    type: 'add',
    terms: [
      {
        type: 'path',
        path: [variable],
      },
      {
        type: 'number',
        value: 1,
      },
    ],
  }
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

  if (expr.type === 'compare') {
    walkExpr(expr.left, visitor)
    walkExpr(expr.right, visitor)
    return
  }

  if (expr.type === 'binary') {
    walkExpr(expr.left, visitor)
    walkExpr(expr.right, visitor)
    return
  }

  if (expr.type === 'logical') {
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

export function checkStrictModeInstructions(instructions, options = {}) {
  const errorFactory = typeof options.errorFactory === 'function' ? options.errorFactory : defaultErrorFactory

  const throwStrict = (line, statement, fnName) => {
    throw errorFactory({
      line,
      kind: 'validation',
      code: 'STRICT_MODE_VIOLATION',
      statement,
      message: `Strict mode forbids ${fnName}().`,
    })
  }

  for (const instr of instructions) {
    if (instr.op === 'call' && FORBIDDEN_STRICT_CALLS.has(instr.name)) {
      throwStrict(instr.line, instr.statement, instr.name)
    }

    const exprFields = []
    if (instr.op === 'assign') exprFields.push(instr.src)
    if (instr.op === 'emit') exprFields.push(instr.src)
    if (instr.op === 'branch') exprFields.push(instr.cond)

    for (const exprField of exprFields) {
      walkExpr(exprField, (exprNode) => {
        if (exprNode.type === 'call' && FORBIDDEN_STRICT_CALLS.has(exprNode.name)) {
          throwStrict(instr.line, instr.statement, exprNode.name)
        }
      })
    }

    if (Array.isArray(instr.args)) {
      for (const arg of instr.args) {
        walkExpr(arg?.expr, (exprNode) => {
          if (exprNode.type === 'call' && FORBIDDEN_STRICT_CALLS.has(exprNode.name)) {
            throwStrict(instr.line, instr.statement, exprNode.name)
          }
        })
      }
    }
  }
}

export function compileAST(statements, options = {}) {
  const errorFactory = typeof options.errorFactory === 'function' ? options.errorFactory : defaultErrorFactory
  const instructions = []
  const stmtIRStart = new Array(statements.length)
  const patches = []
  const forBranchByStmtIndex = new Map()

  const pushInstr = (instr) => {
    instructions.push(instr)
    return instructions.length - 1
  }

  const patchStmtIndex = (instrIndex, field, stmtIndex, line, statement, offset = 0) => {
    patches.push({ instrIndex, field, stmtIndex, line, statement, offset })
  }

  const branchTargetOffsetForStmtIndex = (stmtIndex) => {
    const stmt = statements[stmtIndex]
    if (!stmt) return 0
    if (stmt.type === 'else_if' || stmt.type === 'else') {
      return 1
    }
    return 0
  }

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    stmtIRStart[i] = instructions.length

    if (stmt.type === 'assign') {
      if (stmt.valueExpr?.type === 'call') {
        pushInstr(withSourceMeta(makeCallInstruction(stmt.valueExpr, stmt.line, stmt.statement, stmt.target), stmt))
      } else {
        pushInstr(withSourceMeta({
          op: 'assign',
          dst: stmt.target,
          src: stmt.valueExpr,
          line: stmt.line,
          statement: stmt.statement,
        }, stmt))
      }
      continue
    }

    if (stmt.type === 'append') {
      pushInstr(withSourceMeta({
        op: 'assign',
        dst: stmt.target,
        src: {
          type: 'add',
          terms: [
            { type: 'path', path: stmt.target },
            stmt.valueExpr,
          ],
        },
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      continue
    }

    if (stmt.type === 'expr') {
      pushInstr(withSourceMeta(makeCallInstruction(stmt.expr, stmt.line, stmt.statement, null), stmt))
      continue
    }

    if (stmt.type === 'output') {
      pushInstr(withSourceMeta({
        op: 'emit',
        format: stmt.format,
        src: stmt.valueExpr,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      continue
    }

    if (stmt.type === 'on') {
      const subscribeIndex = pushInstr(withSourceMeta({
        op: 'subscribe',
        eventType: stmt.eventType,
        subscriptionKind: stmt.subscriptionKind === 'external' ? 'external' : 'internal',
        bodyStart: -1,
        bodyEnd: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      patchStmtIndex(subscribeIndex, 'bodyStart', i + 1, stmt.line, stmt.statement)
      patchStmtIndex(subscribeIndex, 'bodyEnd', stmt.endIndex, stmt.line, stmt.statement)

      const jumpIndex = pushInstr(withSourceMeta({
        op: 'jump',
        target: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      patchStmtIndex(jumpIndex, 'target', stmt.endIndex + 1, stmt.line, stmt.statement)
      continue
    }

    if (stmt.type === 'if') {
      const index = pushInstr(withSourceMeta({
        op: 'branch',
        cond: stmt.condition,
        ifFalse: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      const hasNextBranch = typeof stmt.nextBranchIndex === 'number'
      const targetStmt = hasNextBranch ? stmt.nextBranchIndex : stmt.endIndex + 1
      const targetOffset = hasNextBranch ? branchTargetOffsetForStmtIndex(targetStmt) : 0
      patchStmtIndex(index, 'ifFalse', targetStmt, stmt.line, stmt.statement, targetOffset)
      continue
    }

    if (stmt.type === 'else_if') {
      const jumpIndex = pushInstr(withSourceMeta({
        op: 'jump',
        target: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      patchStmtIndex(jumpIndex, 'target', stmt.endIndex + 1, stmt.line, stmt.statement)

      const branchIndex = pushInstr(withSourceMeta({
        op: 'branch',
        cond: stmt.condition,
        ifFalse: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      const hasNextBranch = typeof stmt.nextBranchIndex === 'number'
      const targetStmt = hasNextBranch ? stmt.nextBranchIndex : stmt.endIndex + 1
      const targetOffset = hasNextBranch ? branchTargetOffsetForStmtIndex(targetStmt) : 0
      patchStmtIndex(branchIndex, 'ifFalse', targetStmt, stmt.line, stmt.statement, targetOffset)
      continue
    }

    if (stmt.type === 'else') {
      const jumpIndex = pushInstr(withSourceMeta({
        op: 'jump',
        target: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      patchStmtIndex(jumpIndex, 'target', stmt.endIndex + 1, stmt.line, stmt.statement)
      continue
    }

    if (stmt.type === 'for') {
      const endSlot = forEndSlotName(i)
      pushInstr(withSourceMeta({
        op: 'assign',
        dst: [stmt.variable],
        src: stmt.startExpr,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))

      pushInstr(withSourceMeta({
        op: 'assign',
        dst: [endSlot],
        src: stmt.endExpr,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))

      pushInstr(withSourceMeta({
        op: 'call',
        name: '__nextv_for_validate_range',
        args: [
          {
            kind: 'positional',
            expr: {
              type: 'path',
              path: [stmt.variable],
            },
          },
          {
            kind: 'positional',
            expr: {
              type: 'path',
              path: [endSlot],
            },
          },
        ],
        dst: null,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))

      const branchIndex = pushInstr(withSourceMeta({
        op: 'branch',
        cond: forContinueCondition(stmt.variable, {
          type: 'path',
          path: [endSlot],
        }),
        ifFalse: -1,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      patchStmtIndex(branchIndex, 'ifFalse', stmt.endIndex + 1, stmt.line, stmt.statement)
      forBranchByStmtIndex.set(i, branchIndex)
      continue
    }

    if (stmt.type === 'end') {
      const owner = statements[stmt.startIndex]
      if (owner?.type === 'for') {
        pushInstr(withSourceMeta({
          op: 'assign',
          dst: [owner.variable],
          src: forIncrementExpr(owner.variable),
          line: stmt.line,
          statement: stmt.statement,
        }, stmt))
        const jumpIndex = pushInstr(withSourceMeta({
          op: 'jump',
          target: forBranchByStmtIndex.get(stmt.startIndex),
          line: stmt.line,
          statement: stmt.statement,
        }, stmt))
        if (typeof instructions[jumpIndex].target !== 'number') {
          throw errorFactory({
            line: stmt.line,
            kind: 'validation',
            code: 'INVALID_IR_JUMP_TARGET',
            statement: stmt.statement,
            message: 'For loop jump target could not be resolved.',
          })
        }
      }
      continue
    }

    if (stmt.type === 'stop') {
      pushInstr(withSourceMeta({
        op: 'stop',
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      continue
    }

    if (stmt.type === 'return') {
      pushInstr(withSourceMeta({
        op: 'return_val',
        src: stmt.valueExpr,
        line: stmt.line,
        statement: stmt.statement,
      }, stmt))
      continue
    }

    throw errorFactory({
      line: stmt.line,
      kind: 'validation',
      code: 'UNSUPPORTED_STATEMENT_TYPE',
      statement: stmt.statement,
      message: `Cannot compile statement type "${stmt.type}".`,
    })
  }

  for (const patch of patches) {
    let targetIndex
    if (patch.stmtIndex >= statements.length) {
      targetIndex = instructions.length
    } else {
      targetIndex = stmtIRStart[patch.stmtIndex] + (patch.offset ?? 0)
    }

    if (typeof targetIndex !== 'number' || targetIndex < 0) {
      throw errorFactory({
        line: patch.line,
        kind: 'validation',
        code: 'INVALID_IR_JUMP_TARGET',
        statement: patch.statement,
        message: `Invalid compiler jump target for statement index ${patch.stmtIndex}.`,
      })
    }

    instructions[patch.instrIndex][patch.field] = targetIndex
  }

  if (options.strict === true) {
    checkStrictModeInstructions(instructions, { errorFactory })
  }

  return instructions
}
