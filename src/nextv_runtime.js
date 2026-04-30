import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { NEXTV_AGENT_OUTPUT_FORMATS } from './nextv_agent_output.js'
import { compileAST } from './nextv_compiler.js'
import { extractEventGraph } from './nextv_event_graph.js'

const DEFAULT_MAX_STEPS = 500
const OUTPUT_FORMATS = new Set(['text', 'console', 'voice', 'visual', 'json', 'interaction'])
const VALID_CONTRACT_STATUSES = new Set(['ready', 'needs_input', 'error'])
const AGENT_NAMED_ARG_ALLOWLIST = new Set([
  'agent',
  'prompt',
  'instructions',
  'messages',
  'format',
  'returns',
  'validate',
  'retry_on_contract_violation',
  'on_contract_violation',
])

function isoNow() {
  return new Date().toISOString()
}

export function validateOutputContract(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('Output contract violation: return value must be a plain object.')
    err.code = 'INVALID_OUTPUT_CONTRACT'
    throw err
  }

  if (!('status' in value)) {
    const err = new Error('Output contract violation: missing required field "status".')
    err.code = 'INVALID_OUTPUT_CONTRACT'
    throw err
  }

  if (!VALID_CONTRACT_STATUSES.has(value.status)) {
    const err = new Error(`Output contract violation: "status" must be one of ${[...VALID_CONTRACT_STATUSES].join(', ')}; got "${value.status}".`)
    err.code = 'INVALID_OUTPUT_CONTRACT'
    throw err
  }

  if ('action' in value && value.action !== null && typeof value.action !== 'string') {
    const err = new Error('Output contract violation: "action" must be a string or null.')
    err.code = 'INVALID_OUTPUT_CONTRACT'
    throw err
  }

  if (value.status === 'error' && !('error' in value)) {
    const err = new Error('Output contract violation: "error" field is required when status is "error".')
    err.code = 'INVALID_OUTPUT_CONTRACT'
    throw err
  }
}

class NextVError extends Error {
  constructor({ line, kind, code, statement, message, sourcePath, sourceLine }) {
    super(message)
    this.line = line
    this.kind = kind
    this.code = code
    this.statement = statement
    this.sourcePath = sourcePath
    this.sourceLine = sourceLine
  }
}

function nextvError(partial) {
  return new NextVError(partial)
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function createDelimiterState() {
  return {
    paren: 0,
    brace: 0,
    bracket: 0,
    inQuote: false,
    escaped: false,
  }
}

function advanceDelimiterState(state, ch) {
  if (state.escaped) {
    state.escaped = false
    return
  }

  if (ch === '\\') {
    state.escaped = true
    return
  }

  if (ch === '"') {
    state.inQuote = !state.inQuote
    return
  }

  if (state.inQuote) return

  if (ch === '(') state.paren += 1
  if (ch === ')') state.paren -= 1
  if (ch === '{') state.brace += 1
  if (ch === '}') state.brace -= 1
  if (ch === '[') state.bracket += 1
  if (ch === ']') state.bracket -= 1
}

function isTopLevelState(state) {
  return !state.inQuote && state.paren === 0 && state.brace === 0 && state.bracket === 0
}

function hasUnclosedDelimiters(input) {
  const state = createDelimiterState()
  for (const ch of String(input ?? '')) {
    advanceDelimiterState(state, ch)
  }
  return state.inQuote || state.paren > 0 || state.brace > 0 || state.bracket > 0
}

function splitTopLevel(input, separator) {
  const parts = []
  let current = ''
  const state = createDelimiterState()

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (isTopLevelState(state) && ch === separator) {
      parts.push(current.trim())
      current = ''
      continue
    }
    advanceDelimiterState(state, ch)
    current += ch
  }

  if (state.inQuote) throw new Error('Unterminated string literal.')
  if (!isTopLevelState(state)) throw new Error('Mismatched delimiters.')
  if (current.trim() || parts.length > 0) parts.push(current.trim())
  return parts
}

function findTopLevelEquals(input) {
  const state = createDelimiterState()

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (isTopLevelState(state) && ch === '=') {
      const prev = input[i - 1] ?? ''
      const next = input[i + 1] ?? ''
      if (prev !== '=' && prev !== '!' && prev !== '<' && prev !== '>' && next !== '=') return i
    }
    advanceDelimiterState(state, ch)
  }

  return -1
}

function findTopLevelComparison(input) {
  const state = createDelimiterState()
  const operators = ['==', '!=', '<=', '>=', '<', '>']

  for (let i = 0; i < input.length; i++) {
    if (isTopLevelState(state)) {
      for (const op of operators) {
        if (input.startsWith(op, i)) {
          return { index: i, operator: op }
        }
      }
    }
    advanceDelimiterState(state, input[i])
  }

  return null
}

function findTopLevelLogical(input, operators) {
  const state = createDelimiterState()

  for (let i = 0; i < input.length; i++) {
    if (isTopLevelState(state)) {
      for (const op of operators) {
        if (input.startsWith(op, i)) {
          return { index: i, operator: op }
        }
      }
    }
    advanceDelimiterState(state, input[i])
  }

  return null
}

function findTopLevelColon(input) {
  const state = createDelimiterState()

  for (let i = 0; i < input.length; i++) {
    if (isTopLevelState(state) && input[i] === ':') return i
    advanceDelimiterState(state, input[i])
  }

  return -1
}

function isUnarySignPosition(input, index) {
  const operator = input[index]
  if (operator !== '+' && operator !== '-') return false

  let prevIndex = index - 1
  while (prevIndex >= 0 && /\s/.test(input[prevIndex])) {
    prevIndex -= 1
  }

  if (prevIndex < 0) return true
  return '([{:,+-*/!<>=&|'.includes(input[prevIndex])
}

function findTopLevelArithmetic(input, operators) {
  const state = createDelimiterState()
  let match = null

  for (let i = 0; i < input.length; i++) {
    if (isTopLevelState(state)) {
      for (const operator of operators) {
        if (!input.startsWith(operator, i)) continue
        if ((operator === '+' || operator === '-') && isUnarySignPosition(input, i)) {
          continue
        }
        match = { index: i, operator }
      }
    }
    advanceDelimiterState(state, input[i])
  }

  return match
}

function hasOuterBalancedPair(text, openCh, closeCh) {
  if (!text.startsWith(openCh) || !text.endsWith(closeCh)) return false

  const state = createDelimiterState()

  for (let i = 0; i < text.length; i++) {
    advanceDelimiterState(state, text[i])

    if (state.paren < 0 || state.brace < 0 || state.bracket < 0) {
      return false
    }

    if (isTopLevelState(state) && i < text.length - 1) {
      return false
    }
  }

  return isTopLevelState(state)
}

function hasOuterBalancedParens(text) {
  return hasOuterBalancedPair(text, '(', ')')
}

function parseTarget(raw, line, statement) {
  const target = String(raw ?? '').trim()
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(target)) {
    throw nextvError({
      line,
      kind: 'parse',
      code: 'INVALID_ASSIGNMENT_TARGET',
      statement,
      message: `Invalid assignment target "${target}".`,
    })
  }
  if (target === 'event') {
    throw nextvError({
      line,
      kind: 'parse',
      code: 'EVENT_ASSIGNMENT_FORBIDDEN',
      statement,
      message: 'event is read-only and cannot be assigned.',
    })
  }
  return target.split('.')
}

function parseFunctionArgs(raw, line, statement) {
  const text = String(raw ?? '').trim()
  if (!text) return []
  const chunks = splitTopLevel(text, ',').filter(Boolean)
  return chunks.map((chunk) => {
    const eq = findTopLevelEquals(chunk)
    if (eq <= 0) {
      return { kind: 'positional', expr: parseExpression(chunk, line, statement) }
    }
    const name = chunk.slice(0, eq).trim()
    const valueRaw = chunk.slice(eq + 1).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_NAMED_ARGUMENT',
        statement,
        message: `Invalid named argument key "${name}".`,
      })
    }
    if (!valueRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_NAMED_ARGUMENT',
        statement,
        message: `Named argument "${name}" must have a value.`,
      })
    }
    return { kind: 'named', name, expr: parseExpression(valueRaw, line, statement) }
  })
}

function parseObjectLiteral(raw, line, statement) {
  const inner = String(raw ?? '').trim().slice(1, -1).trim()
  if (!inner) return { type: 'object', entries: [] }

  const entries = splitTopLevel(inner, ',').filter(Boolean)
  return {
    type: 'object',
    entries: entries.map((entryRaw) => {
      const colon = findTopLevelColon(entryRaw)
      if (colon <= 0) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_EXPRESSION',
          statement,
          message: `Invalid object entry "${entryRaw}". Expected key: value.`,
        })
      }

      const keyRaw = entryRaw.slice(0, colon).trim()
      const valueRaw = entryRaw.slice(colon + 1).trim()
      let key = null

      if (keyRaw.startsWith('"') && keyRaw.endsWith('"')) {
        key = decodeEscapes(keyRaw.slice(1, -1))
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(keyRaw)) {
        key = keyRaw
      }

      if (!key) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_EXPRESSION',
          statement,
          message: `Invalid object key "${keyRaw}". Use an identifier or quoted string key.`,
        })
      }

      if (!valueRaw) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_EXPRESSION',
          statement,
          message: `Object key "${key}" must have a value.`,
        })
      }

      return {
        key,
        valueExpr: parseExpression(valueRaw, line, statement),
      }
    }),
  }
}

function parseArrayLiteral(raw, line, statement) {
  const inner = String(raw ?? '').trim().slice(1, -1).trim()
  if (!inner) return { type: 'array', elements: [] }

  const elements = splitTopLevel(inner, ',').filter(Boolean).map((valueRaw) => parseExpression(valueRaw, line, statement))
  return { type: 'array', elements }
}

function parseTerm(raw, line, statement) {
  const text = String(raw ?? '').trim()
  if (!text) {
    throw nextvError({
      line,
      kind: 'parse',
      code: 'INVALID_EXPRESSION',
      statement,
      message: 'Expression cannot be empty.',
    })
  }

  if (hasOuterBalancedParens(text)) {
    return parseExpression(text.slice(1, -1), line, statement)
  }

  if (text.startsWith('"') && text.endsWith('"')) {
    return { type: 'string', value: text.slice(1, -1) }
  }

  if (text === 'true' || text === 'false') {
    return { type: 'boolean', value: text === 'true' }
  }

  if (text === 'null') {
    return { type: 'null', value: null }
  }

  if (hasOuterBalancedPair(text, '{', '}')) {
    return parseObjectLiteral(text, line, statement)
  }

  if (hasOuterBalancedPair(text, '[', ']')) {
    return parseArrayLiteral(text, line, statement)
  }

  if (/^[-+]?\d+(?:\.\d+)?$/.test(text)) {
    return { type: 'number', value: Number(text) }
  }

  const fnMatch = /^([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*)\)$/.exec(text)
  if (fnMatch) {
    return {
      type: 'call',
      name: fnMatch[1],
      args: parseFunctionArgs(fnMatch[2], line, statement),
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(text)) {
    return { type: 'path', path: text.split('.') }
  }

  throw nextvError({
    line,
    kind: 'parse',
    code: 'INVALID_EXPRESSION',
    statement,
    message: `Could not parse expression "${text}".`,
  })
}

function parseAddExpression(raw, line, statement) {
  const operatorMatch = findTopLevelArithmetic(String(raw ?? '').trim(), ['+', '-'])
  if (operatorMatch) {
    const text = String(raw ?? '').trim()
    const leftRaw = text.slice(0, operatorMatch.index).trim()
    const rightRaw = text.slice(operatorMatch.index + operatorMatch.operator.length).trim()
    if (!leftRaw || !rightRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_EXPRESSION',
        statement,
        message: `Invalid arithmetic expression "${text}".`,
      })
    }

    const left = parseAddExpression(leftRaw, line, statement)
    const right = parseMultiplyExpression(rightRaw, line, statement)
    if (operatorMatch.operator === '+') {
      const terms = left.type === 'add' ? [...left.terms, right] : [left, right]
      return { type: 'add', terms }
    }

    return {
      type: 'binary',
      operator: operatorMatch.operator,
      left,
      right,
    }
  }

  return parseMultiplyExpression(raw, line, statement)
}

function parseMultiplyExpression(raw, line, statement) {
  const text = String(raw ?? '').trim()
  const operatorMatch = findTopLevelArithmetic(text, ['*', '/'])
  if (operatorMatch) {
    const leftRaw = text.slice(0, operatorMatch.index).trim()
    const rightRaw = text.slice(operatorMatch.index + operatorMatch.operator.length).trim()
    if (!leftRaw || !rightRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_EXPRESSION',
        statement,
        message: `Invalid arithmetic expression "${text}".`,
      })
    }

    return {
      type: 'binary',
      operator: operatorMatch.operator,
      left: parseMultiplyExpression(leftRaw, line, statement),
      right: parseTerm(rightRaw, line, statement),
    }
  }

  const parts = splitTopLevel(String(raw ?? '').trim(), '+').filter(Boolean)
  if (parts.length === 0) {
    throw nextvError({
      line,
      kind: 'parse',
      code: 'INVALID_EXPRESSION',
      statement,
      message: 'Expression cannot be empty.',
    })
  }

  const terms = parts.map((part) => parseTerm(part, line, statement))
  if (terms.length === 1) return terms[0]
  return { type: 'add', terms }
}

function parseExpression(raw, line, statement) {
  const text = String(raw ?? '').trim()

  const logicalOr = findTopLevelLogical(text, ['||', '|'])
  if (logicalOr) {
    const leftRaw = text.slice(0, logicalOr.index).trim()
    const rightRaw = text.slice(logicalOr.index + logicalOr.operator.length).trim()
    if (!leftRaw || !rightRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_EXPRESSION',
        statement,
        message: `Invalid logical expression "${text}".`,
      })
    }

    return {
      type: 'logical',
      operator: 'or',
      left: parseExpression(leftRaw, line, statement),
      right: parseExpression(rightRaw, line, statement),
    }
  }

  const logicalAnd = findTopLevelLogical(text, ['&&', '&'])
  if (logicalAnd) {
    const leftRaw = text.slice(0, logicalAnd.index).trim()
    const rightRaw = text.slice(logicalAnd.index + logicalAnd.operator.length).trim()
    if (!leftRaw || !rightRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_EXPRESSION',
        statement,
        message: `Invalid logical expression "${text}".`,
      })
    }

    return {
      type: 'logical',
      operator: 'and',
      left: parseExpression(leftRaw, line, statement),
      right: parseExpression(rightRaw, line, statement),
    }
  }

  const comparison = findTopLevelComparison(text)
  if (comparison) {
    const leftRaw = text.slice(0, comparison.index).trim()
    const rightRaw = text.slice(comparison.index + comparison.operator.length).trim()
    if (!leftRaw || !rightRaw) {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_EXPRESSION',
        statement,
        message: `Invalid comparison expression "${text}".`,
      })
    }

    return {
      type: 'compare',
      operator: comparison.operator,
      left: parseAddExpression(leftRaw, line, statement),
      right: parseAddExpression(rightRaw, line, statement),
    }
  }

  return parseAddExpression(text, line, statement)
}

function expandNextVIncludes(source, options = {}) {
  const lines = String(source ?? '').split(/\r?\n/)
  const expandedLines = []
  const sourceMap = []
  const baseDir = String(options.baseDir ?? '').trim()
  const currentFilePath = String(options.filePath ?? '').trim()
  const stack = Array.isArray(options.stack) ? options.stack : []

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1
    const statement = lines[i]
    const trimmed = statement.trim()

    const includeMatch = /^include\s+"((?:[^"\\]|\\.)*)"$/.exec(trimmed)
    if (!includeMatch) {
      expandedLines.push(statement)
      sourceMap.push({
        sourcePath: currentFilePath,
        sourceLine: lineNumber,
      })
      continue
    }

    const includePath = decodeEscapes(includeMatch[1]).trim()
    if (!includePath) {
      throw nextvError({
        line: lineNumber,
        kind: 'parse',
        code: 'INVALID_INCLUDE_SYNTAX',
        statement,
        message: 'include path cannot be empty.',
      })
    }

    const includeBase = currentFilePath ? dirname(currentFilePath) : baseDir
    if (!includeBase) {
      throw nextvError({
        line: lineNumber,
        kind: 'parse',
        code: 'INCLUDE_BASE_DIR_REQUIRED',
        statement,
        message: 'include requires baseDir context. Use runNextVScriptFromFile(...) or parseNextVScript(..., { baseDir }).',
      })
    }

    const includeAbsolutePath = resolve(includeBase, includePath)
    if (stack.includes(includeAbsolutePath)) {
      throw nextvError({
        line: lineNumber,
        kind: 'parse',
        code: 'INCLUDE_CYCLE',
        statement,
        message: `include cycle detected: ${[...stack, includeAbsolutePath].join(' -> ')}`,
      })
    }

    let includeSource = ''
    try {
      includeSource = readFileSync(includeAbsolutePath, 'utf8')
    } catch {
      throw nextvError({
        line: lineNumber,
        kind: 'parse',
        code: 'INCLUDE_NOT_FOUND',
        statement,
        message: `Included file not found: ${includePath}`,
      })
    }

    const expanded = expandNextVIncludes(includeSource, {
      baseDir: dirname(includeAbsolutePath),
      filePath: includeAbsolutePath,
      stack: [...stack, includeAbsolutePath],
    })
    expandedLines.push(...expanded.lines)
    sourceMap.push(...expanded.sourceMap)
  }

  return {
    source: expandedLines.join('\n'),
    lines: expandedLines,
    sourceMap,
  }
}

export function parseNextVScript(source, options = {}) {
  const expanded = expandNextVIncludes(source, {
    baseDir: options.baseDir,
    filePath: options.filePath,
    stack: options.filePath ? [String(options.filePath)] : [],
  })
  const lines = Array.isArray(expanded.lines)
    ? expanded.lines
    : String(expanded.source ?? '').split(/\r?\n/)
  const sourceMap = Array.isArray(expanded.sourceMap) ? expanded.sourceMap : []
  const statements = []

  for (let i = 0; i < lines.length; i++) {
    const line = i + 1
    const sourceRef = sourceMap[i] ?? null
    const sourcePath = String(sourceRef?.sourcePath ?? '').trim()
    const sourceLineRaw = Number(sourceRef?.sourceLine)
    const sourceLine = Number.isFinite(sourceLineRaw) ? sourceLineRaw : null
    const sourceMeta = {}
    if (sourcePath) sourceMeta.sourcePath = sourcePath
    if (sourceLine !== null) sourceMeta.sourceLine = sourceLine
    let statement = lines[i]
    let trimmed = statement.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    while (trimmed && hasUnclosedDelimiters(trimmed)) {
      if (i >= lines.length - 1) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_EXPRESSION',
          statement,
          message: 'Expression is missing a closing delimiter.',
        })
      }
      i += 1
      statement = `${statement}\n${lines[i]}`
      trimmed = statement.trim()
    }

    if (trimmed === 'end') {
      statements.push({ type: 'end', line, statement, ...sourceMeta })
      continue
    }
    if (trimmed === 'else') {
      statements.push({ type: 'else', line, statement, ...sourceMeta })
      continue
    }
    if (trimmed.startsWith('else if ')) {
      statements.push({
        type: 'else_if',
        line,
        statement,
        ...sourceMeta,
        condition: parseExpression(trimmed.slice(8), line, statement),
      })
      continue
    }
    if (trimmed === 'stop') {
      statements.push({ type: 'stop', line, statement, ...sourceMeta })
      continue
    }

    if (trimmed.startsWith('return ')) {
      statements.push({
        type: 'return',
        line,
        statement,
        ...sourceMeta,
        valueExpr: parseExpression(trimmed.slice(7), line, statement),
      })
      continue
    }

    if (trimmed.startsWith('output ')) {
      const outputMatch = /^output\s+([A-Za-z_][A-Za-z0-9_-]*)\s+([\s\S]+)$/.exec(trimmed)
      if (!outputMatch) {
        // Allow assignments like: output = my_fn(...)
        // to be parsed by assignment handling below.
      } else {
        const format = outputMatch[1]

        statements.push({
          type: 'output',
          format,
          line,
          statement,
          ...sourceMeta,
          valueExpr: parseExpression(outputMatch[2], line, statement),
        })
        continue
      }
    }

    if (trimmed.startsWith('print ')) {
      statements.push({
        type: 'output',
        format: 'text',
        line,
        statement,
        ...sourceMeta,
        valueExpr: parseExpression(trimmed.slice(6), line, statement),
      })
      continue
    }

    if (trimmed === 'loop') {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'LOOP_REMOVED',
        statement,
        message: 'loop is removed in vNext. Use runtime-level event scheduling instead.',
      })
    }

    if (trimmed.startsWith('if ')) {
      statements.push({
        type: 'if',
        line,
        statement,
        ...sourceMeta,
        condition: parseExpression(trimmed.slice(3), line, statement),
      })
      continue
    }

    if (trimmed.startsWith('for ')) {
      const match = /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([\s\S]+?)\.\.([\s\S]+)$/.exec(trimmed)
      if (!match) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_FOR_SYNTAX',
          statement,
          message: 'Invalid for syntax. Expected: for <var> in <start>..<end>.',
        })
      }
      statements.push({
        type: 'for',
        line,
        statement,
        ...sourceMeta,
        variable: match[1],
        startExpr: parseExpression(match[2].trim(), line, statement),
        endExpr: parseExpression(match[3].trim(), line, statement),
      })
      continue
    }

    if (trimmed.startsWith('on ')) {
      // Supported forms:
      // - on "event_type"
      // - on external "event_type"
      const externalMatch = /^on\s+external\s+"((?:[^"\\]|\\.)*)"$/.exec(trimmed)
      const internalMatch = /^on\s+"((?:[^"\\]|\\.)*)"$/.exec(trimmed)
      const match = externalMatch ?? internalMatch
      if (!match) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_ON_SYNTAX',
          statement,
          message: 'Invalid on syntax. Expected: on "event_type" or on external "event_type".',
        })
      }
      const subscriptionKind = externalMatch ? 'external' : 'internal'
      const eventType = decodeEscapes(match[1])
      if (!eventType.trim()) {
        throw nextvError({
          line,
          kind: 'parse',
          code: 'INVALID_ON_SYNTAX',
          statement,
          message: 'on event type cannot be empty.',
        })
      }
      statements.push({
        type: 'on',
        subscriptionKind,
        line,
        statement,
        ...sourceMeta,
        eventType,
      })
      continue
    }

    const appendMatch = /^([A-Za-z_][A-Za-z0-9_.]*)\s*\+=\s*([\s\S]+)$/.exec(trimmed)
    if (appendMatch) {
      statements.push({
        type: 'append',
        line,
        statement,
        ...sourceMeta,
        target: parseTarget(appendMatch[1], line, statement),
        valueExpr: parseExpression(appendMatch[2], line, statement),
      })
      continue
    }

    const assignMatch = /^([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*([\s\S]+)$/.exec(trimmed)
    if (assignMatch) {
      statements.push({
        type: 'assign',
        line,
        statement,
        ...sourceMeta,
        target: parseTarget(assignMatch[1], line, statement),
        valueExpr: parseExpression(assignMatch[2], line, statement),
      })
      continue
    }

    const expr = parseExpression(trimmed, line, statement)
    if (expr.type !== 'call') {
      throw nextvError({
        line,
        kind: 'parse',
        code: 'INVALID_STATEMENT',
        statement,
        message: 'Standalone statements must be function calls.',
      })
    }
    statements.push({ type: 'expr', line, statement, ...sourceMeta, expr })
  }

  const stack = []
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]
    if (stmt.type === 'if' || stmt.type === 'for') {
      stack.push({ index: i, type: stmt.type, hasElse: false, lastBranchIndex: i })
      continue
    }
    if (stmt.type === 'on') {
      if (stack.length > 0) {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'ON_NESTING_FORBIDDEN',
          statement: stmt.statement,
          message: 'on blocks are only allowed at top-level scope.',
        })
      }
      stack.push({ index: i, type: stmt.type })
      continue
    }
    if (stmt.type === 'else_if') {
      const top = stack[stack.length - 1]
      if (!top || top.type !== 'if') {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'UNMATCHED_ELSE_IF',
          statement: stmt.statement,
          message: 'Found else if without matching if.',
        })
      }
      if (top.hasElse) {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'ELSE_IF_AFTER_ELSE',
          statement: stmt.statement,
          message: 'else if cannot appear after else in the same if block.',
        })
      }
      statements[top.lastBranchIndex].nextBranchIndex = i
      top.lastBranchIndex = i
      stmt.startIndex = top.index
      continue
    }
    if (stmt.type === 'else') {
      const top = stack[stack.length - 1]
      if (!top || top.type !== 'if') {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'UNMATCHED_ELSE',
          statement: stmt.statement,
          message: 'Found else without matching if.',
        })
      }
      if (top.hasElse) {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'DUPLICATE_ELSE',
          statement: stmt.statement,
          message: 'if block can contain at most one else.',
        })
      }
      statements[top.lastBranchIndex].nextBranchIndex = i
      top.hasElse = true
      stmt.startIndex = top.index
      continue
    }
    if (stmt.type === 'end') {
      const top = stack.pop()
      if (!top) {
        throw nextvError({
          line: stmt.line,
          kind: 'validation',
          code: 'UNMATCHED_END',
          statement: stmt.statement,
          message: 'Found end without matching block start.',
        })
      }
      stmt.startIndex = top.index
      if (top.type === 'if') {
        let branchIndex = top.index
        while (typeof branchIndex === 'number') {
          statements[branchIndex].endIndex = i
          const nextBranch = statements[branchIndex].nextBranchIndex
          if (typeof nextBranch !== 'number') break
          branchIndex = nextBranch
        }
      } else {
        statements[top.index].endIndex = i
      }
    }
  }

  if (stack.length > 0) {
    const open = statements[stack[stack.length - 1].index]
    throw nextvError({
      line: open.line,
      kind: 'validation',
      code: 'MISSING_END',
      statement: open.statement,
      message: `${open.type} block is missing a matching end.`,
    })
  }

  return statements
}

function decodeEscapes(raw) {
  return String(raw)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function cloneState(state) {
  if (!isPlainObject(state)) return {}
  return JSON.parse(JSON.stringify(state))
}

function cloneLocals(locals) {
  if (!isPlainObject(locals)) return {}
  return JSON.parse(JSON.stringify(locals))
}

function isStructuredValue(value) {
  return value != null && typeof value === 'object'
}

function coerceTextValue(value, context, usage) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (isStructuredValue(value)) {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'STRUCTURED_STRING_COERCION',
      statement: context.statement,
      message: `${usage} cannot implicitly stringify structured values. Use to_json(...) explicitly.`,
    })
  }
  return String(value)
}

function requireArithmeticNumber(value, context, usage) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  throw nextvError({
    line: context.line,
    kind: 'runtime',
    code: 'INVALID_ARITHMETIC_OPERAND',
    statement: context.statement,
    message: `${usage} requires finite numeric operands.`,
  })
}

function normalizeAgentMessagesValue(value, context) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'INVALID_AGENT_MESSAGES',
      statement: context.statement,
      message: 'agent() messages must be an array of { role, content } objects.',
    })
  }

  const normalized = []
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    if (!isPlainObject(entry)) {
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'INVALID_AGENT_MESSAGES',
        statement: context.statement,
        message: `agent() messages[${i}] must be an object.`,
      })
    }

    const role = String(entry.role ?? '').trim()
    const content = String(entry.content ?? '').trim()
    if (!role) {
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'INVALID_AGENT_MESSAGES',
        statement: context.statement,
        message: `agent() messages[${i}] is missing role.`,
      })
    }
    if (!content) {
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'INVALID_AGENT_MESSAGES',
        statement: context.statement,
        message: `agent() messages[${i}] is missing content.`,
      })
    }

    const normalizedEntry = { role, content }

    if (entry.images != null) {
      if (!Array.isArray(entry.images)) {
        throw nextvError({
          line: context.line,
          kind: 'runtime',
          code: 'INVALID_AGENT_MESSAGES',
          statement: context.statement,
          message: `agent() messages[${i}].images must be an array.`,
        })
      }
      const imgs = entry.images.map((img) => String(img ?? '').trim()).filter(Boolean)
      if (imgs.length > 0) {
        normalizedEntry.images = imgs
      }
    }

    normalized.push(normalizedEntry)
  }

  return normalized
}

function toJsonText(value, context, usage) {
  try {
    const encoded = JSON.stringify(value, null, 2)
    if (encoded !== undefined) return encoded
  } catch (err) {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'JSON_SERIALIZATION_ERROR',
      statement: context.statement,
      message: `${usage} failed to serialize value as JSON: ${String(err?.message ?? err)}`,
    })
  }

  throw nextvError({
    line: context.line,
    kind: 'runtime',
    code: 'JSON_SERIALIZATION_ERROR',
    statement: context.statement,
    message: `${usage} could not serialize value as JSON.`,
  })
}

function normalizeAgentReturnsValue(value, context) {
  if (value == null) return null
  if (typeof value !== 'object') {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'INVALID_AGENT_RETURNS',
      statement: context.statement,
      message: 'agent() returns must be a plain object or array.',
    })
  }
  return value
}

function formatOutputContent(value, format, context) {
  if (format === 'interaction') {
    return toJsonText(value, context, 'output interaction')
  }

  if (format !== 'json') {
    return coerceTextValue(value, context, `output ${format}`)
  }

  try {
    const encoded = JSON.stringify(value, null, 2)
    if (encoded !== undefined) return encoded
  } catch {
    // Fall through to string fallback when JSON encoding is not possible.
  }

  return String(value ?? '')
}

function resolvePath(path, locals, state, event, context) {
  const [root, ...rest] = path
  const allowUndefinedPath = context?.allowUndefinedPath === true
  let cursor
  if (root === 'state') {
    cursor = state
  } else if (root === 'event') {
    cursor = event
  } else {
    if (!(root in locals)) {
      if (allowUndefinedPath) return undefined
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'UNDEFINED_VARIABLE',
        statement: context.statement,
        message: `Undefined variable "${root}".`,
      })
    }
    cursor = locals[root]
  }

  for (const segment of rest) {
    if (!isPlainObject(cursor) && !Array.isArray(cursor)) {
      if (allowUndefinedPath) return undefined
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'UNDEFINED_VARIABLE',
        statement: context.statement,
        message: `Cannot access "${segment}" on non-object value.`,
      })
    }
    if (!(segment in cursor)) {
      if (allowUndefinedPath) return undefined
      throw nextvError({
        line: context.line,
        kind: 'runtime',
        code: 'UNDEFINED_VARIABLE',
        statement: context.statement,
        message: `Undefined variable "${path.join('.')}".`,
      })
    }
    cursor = cursor[segment]
  }
  return cursor
}

function interpolateString(value, locals, state, event, context) {
  return decodeEscapes(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_m, pathRaw) => {
    const resolved = resolvePath(pathRaw.split('.'), locals, state, event, context)
    return coerceTextValue(resolved, context, 'String interpolation')
  })
}

async function evaluateExpression(expr, context) {
  if (expr.type === 'number' || expr.type === 'boolean' || expr.type === 'null') return expr.value

  if (expr.type === 'string') {
    return interpolateString(expr.value, context.locals, context.state, context.event, context)
  }

  if (expr.type === 'path') {
    return resolvePath(expr.path, context.locals, context.state, context.event, context)
  }

  if (expr.type === 'array') {
    const values = []
    for (const element of expr.elements ?? []) {
      values.push(await evaluateExpression(element, context))
    }
    return values
  }

  if (expr.type === 'object') {
    const value = {}
    for (const entry of expr.entries ?? []) {
      value[entry.key] = await evaluateExpression(entry.valueExpr, context)
    }
    return value
  }

  if (expr.type === 'add') {
    const values = []
    for (const term of expr.terms) {
      values.push(await evaluateExpression(term, context))
    }

    const allNumeric = values.every((v) => typeof v === 'number' && Number.isFinite(v))
    if (allNumeric) {
      return values.reduce((sum, n) => sum + n, 0)
    }

    const allArrays = values.every((v) => Array.isArray(v))
    if (allArrays) {
      return values.flatMap((v) => v)
    }

    return values.map((v) => coerceTextValue(v, context, 'Operator +')).join('')
  }

  if (expr.type === 'binary') {
    const left = requireArithmeticNumber(await evaluateExpression(expr.left, context), context, `Operator ${expr.operator}`)
    const right = requireArithmeticNumber(await evaluateExpression(expr.right, context), context, `Operator ${expr.operator}`)

    if (expr.operator === '-') return left - right
    if (expr.operator === '*') return left * right
    if (expr.operator === '/') {
      if (right === 0) {
        throw nextvError({
          line: context.line,
          kind: 'runtime',
          code: 'DIVISION_BY_ZERO',
          statement: context.statement,
          message: 'Operator / cannot divide by zero.',
        })
      }
      return left / right
    }
  }

  if (expr.type === 'compare') {
    const left = await evaluateExpression(expr.left, context)
    const right = await evaluateExpression(expr.right, context)
    if (expr.operator === '==') return left === right
    if (expr.operator === '!=') return left !== right
    if (expr.operator === '<=') return Number(left) <= Number(right)
    if (expr.operator === '>=') return Number(left) >= Number(right)
    if (expr.operator === '<') return Number(left) < Number(right)
    if (expr.operator === '>') return Number(left) > Number(right)
  }

  if (expr.type === 'logical') {
    if (expr.operator === 'and') {
      const left = await evaluateExpression(expr.left, context)
      if (!left) return false
      const right = await evaluateExpression(expr.right, context)
      return Boolean(right)
    }
    if (expr.operator === 'or') {
      const left = await evaluateExpression(expr.left, context)
      if (left) return true
      const right = await evaluateExpression(expr.right, context)
      return Boolean(right)
    }
  }

  if (expr.type === 'call') {
    return executeFunctionCall(expr.name, expr.args, context, 'expression')
  }

  throw nextvError({
    line: context.line,
    kind: 'runtime',
    code: 'INVALID_EXPRESSION',
    statement: context.statement,
    message: `Unsupported expression type "${expr.type}".`,
  })
}

async function evaluateCallArgs(args, context) {
  const positional = []
  const named = {}

  for (const arg of args ?? []) {
    if (arg.kind === 'named') {
      if (arg.name === 'on_contract_violation') {
        // Keep violation handler as expression so `violation` is resolved only
        // when a contract violation is actually produced.
        named[arg.name] = arg.expr
        continue
      }

      const value = await evaluateExpression(arg.expr, context)
      named[arg.name] = value
    } else {
      const value = await evaluateExpression(arg.expr, context)
      positional.push(value)
    }
  }

  return { positional, named }
}

function normalizeExecutionRole(role, fallback = 'router') {
  const normalized = String(role ?? '').trim().toLowerCase()
  if (normalized === 'router' || normalized === 'operator' || normalized === 'script') {
    return normalized
  }
  return fallback
}

function getRoleWarningForEmit(executionRole) {
  if (executionRole === 'operator') {
    return {
      code: 'ROLE_EMIT_DISCOURAGED',
      message: 'emit() is discouraged in operator role; operators should not own global orchestration.',
    }
  }
  if (executionRole === 'script') {
    return {
      code: 'ROLE_EMIT_DISCOURAGED',
      message: 'emit() is discouraged in script role; bounded scripts should avoid event routing.',
    }
  }
  return null
}

function getRoleWarningForOutput(executionRole, format) {
  if (executionRole === 'operator') {
    return {
      code: 'ROLE_OUTPUT_DISCOURAGED',
      message: `output ${format} is discouraged in operator role; operators should return data instead of producing visible effects.`,
    }
  }
  if (executionRole === 'script') {
    return {
      code: 'ROLE_OUTPUT_DISCOURAGED',
      message: `output ${format} is discouraged in script role; bounded scripts should avoid host-visible effects.`,
    }
  }
  return null
}

async function executeFunctionCall(name, args, context, origin) {
  const fn = context.functions[name]
  if (typeof fn !== 'function') {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'UNKNOWN_FUNCTION',
      statement: context.statement,
      message: `Unknown function "${name}".`,
    })
  }

  const { positional, named } = await evaluateCallArgs(args, context)

  if (context.emitTraceCall) {
    await context.emitTraceCall({
      phase: 'before',
      name,
      origin,
      executionRole: context.executionRole,
      args: { positional, named },
    })
  }

  const emitToolEvents = name !== 'input' && name !== 'emit' && name !== 'tool' && !name.startsWith('__nextv_')

  if (emitToolEvents) {
    await context.emitEvent({
      type: 'tool_call',
      tool: name,
      args: {
        positional,
        named,
      },
    })
  }

  let result
  try {
    result = await fn({
      positional,
      named,
      state: context.state,
      event: context.event,
      locals: context.locals,
      line: context.line,
      statement: context.statement,
        sourcePath: context.sourcePath,
        sourceLine: context.sourceLine,
    })
  } catch (err) {
    if (err instanceof NextVError) throw err
    if (err?.code === 'INVALID_OUTPUT_CONTRACT') throw err
    if (err?.code === 'AGENT_RETURN_CONTRACT_VIOLATION') throw err
    throw nextvError({
      line: context.line,
      sourcePath: context.sourcePath,
      sourceLine: context.sourceLine,
      kind: 'runtime',
      code: 'FUNCTION_CALL_ERROR',
      statement: context.statement,
      message: `${name}() failed: ${String(err?.message ?? err ?? 'Unknown function call error')}`,
    })
  }

  if (emitToolEvents) {
    await context.emitEvent({
      type: 'tool_result',
      tool: name,
      result,
    })
  }

  if (context.emitTraceCall) {
    await context.emitTraceCall({
      phase: 'after',
      name,
      origin,
      executionRole: context.executionRole,
      result,
    })
  }

  return result
}

async function assignTarget(path, value, locals, state, context) {
  const [root, ...rest] = path
  if (root === 'event') {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'EVENT_ASSIGNMENT_FORBIDDEN',
      statement: context.statement,
      message: 'event is read-only and cannot be assigned.',
    })
  }

  if (root === 'state') {
    const shouldEmitState = context.emitStateUpdates === true
    const prevState = shouldEmitState ? cloneState(state) : null

    if (rest.length === 0) {
      if (!isPlainObject(value)) {
        throw nextvError({
          line: context.line,
          kind: 'runtime',
          code: 'INVALID_STATE_ASSIGNMENT',
          statement: context.statement,
          message: 'state must remain an object.',
        })
      }
      Object.keys(state).forEach((k) => delete state[k])
      Object.assign(state, value)
      if (shouldEmitState) {
        await context.emitEvent({
          type: 'state_update',
          prev: prevState,
          next: cloneState(state),
        })
      }
      return
    }

    let cursor = state
    for (let i = 0; i < rest.length - 1; i++) {
      const segment = rest[i]
      if (!(segment in cursor)) cursor[segment] = {}
      if (!isPlainObject(cursor[segment])) {
        throw nextvError({
          line: context.line,
          kind: 'runtime',
          code: 'INVALID_STATE_ASSIGNMENT',
          statement: context.statement,
          message: `state.${segment} is not an object.`,
        })
      }
      cursor = cursor[segment]
    }

    cursor[rest[rest.length - 1]] = value
    if (shouldEmitState) {
      await context.emitEvent({
        type: 'state_update',
        path: `state.${rest.join('.')}`,
        prev: prevState,
        next: cloneState(state),
      })
    }
    return
  }

  if (rest.length > 0) {
    throw nextvError({
      line: context.line,
      kind: 'runtime',
      code: 'INVALID_ASSIGNMENT_TARGET',
      statement: context.statement,
      message: 'Only plain local variables or state.<path> can be assignment targets.',
    })
  }

  locals[root] = value
}

function defaultInputValue(event) {
  if (event == null) return null
  if (typeof event === 'string') return event
  if (isPlainObject(event)) {
    if ('value' in event) return event.value
    if ('payload' in event) return event.payload
  }
  return event
}

function buildFunctions(options, runtimeContext) {
  const customFns = options.functions ?? {}
  const baseDir = options.baseDir ?? process.cwd()

  const runtimeUnavailable = (code, message) => {
    throw nextvError({
      line: runtimeContext.line,
      kind: 'runtime',
      code,
      statement: runtimeContext.statement,
      message,
    })
  }

  const collectionError = (code, message) => {
    throw nextvError({
      line: runtimeContext.line,
      kind: 'runtime',
      code,
      statement: runtimeContext.statement,
      message,
    })
  }

  const requireArray = (value, fnName) => {
    if (!Array.isArray(value)) {
      collectionError('INVALID_COLLECTION_ARGUMENT', `${fnName}() requires an array as first argument.`)
    }
    return value
  }

  const requireKeyName = (value, fnName) => {
    const keyName = String(value ?? '').trim()
    if (!keyName) {
      collectionError('INVALID_COLLECTION_ARGUMENT', `${fnName}() requires a non-empty key as second argument.`)
    }
    return keyName
  }

    const requireCutOperator = (value) => {
      const operator = String(value ?? '').trim()
      if (operator === '>' || operator === '>=' || operator === '<' || operator === '<=') {
        return operator
      }
      collectionError(
        'INVALID_COLLECTION_ARGUMENT',
        `cut() requires one of ">", ">=", "<", or "<=" as third argument; received "${value}".`,
      )
    }

  const readKey = (entry, keyName) => (isPlainObject(entry) ? entry[keyName] : undefined)

  return {
    concat: ({ positional }) => positional.map((v) => coerceTextValue(v, runtimeContext, 'concat()')).join(''),
    length: ({ positional }) => {
      const value = positional[0]
      if (Array.isArray(value) || typeof value === 'string') return value.length
      if (isPlainObject(value)) return Object.keys(value).length
      collectionError('INVALID_COLLECTION_ARGUMENT', 'length() requires an array, string, or object argument.')
    },
    take: ({ positional }) => {
      const list = requireArray(positional[0], 'take')
      const nRaw = positional[1]
      const n = Number(nRaw)
      if (!Number.isInteger(n)) {
        collectionError('INVALID_COLLECTION_ARGUMENT', `take() requires an integer count as second argument; received "${nRaw}".`)
      }
      if (n <= 0) return []
      return list.slice(0, n)
    },
    find_by: ({ positional }) => {
      const list = requireArray(positional[0], 'find_by')
      const keyName = requireKeyName(positional[1], 'find_by')
      const expected = positional[2]
      for (const entry of list) {
        if (readKey(entry, keyName) === expected) return entry
      }
      return null
    },
    remove_by: ({ positional }) => {
      const list = requireArray(positional[0], 'remove_by')
      const keyName = requireKeyName(positional[1], 'remove_by')
      const expected = positional[2]
      return list.filter((entry) => readKey(entry, keyName) !== expected)
    },
    dedupe_by: ({ positional }) => {
      const list = requireArray(positional[0], 'dedupe_by')
      const keyName = requireKeyName(positional[1], 'dedupe_by')
      const seen = new Set()
      const out = []
      for (const entry of list) {
        const keyValue = readKey(entry, keyName)
        if (seen.has(keyValue)) continue
        seen.add(keyValue)
        out.push(entry)
      }
      return out
    },
    sort: ({ positional, named }) => {
      const list = requireArray(positional[0], 'sort')
      const keyName = requireKeyName(positional[1], 'sort')
      const desc = named?.desc === true
      const sorted = list.slice().sort((a, b) => {
        const av = readKey(a, keyName)
        const bv = readKey(b, keyName)
        if (typeof av === 'number' && typeof bv === 'number') {
          return desc ? bv - av : av - bv
        }
        const as = String(av ?? '')
        const bs = String(bv ?? '')
        return desc ? bs.localeCompare(as) : as.localeCompare(bs)
      })
      return sorted
    },
    cut: ({ positional }) => {
      const list = requireArray(positional[0], 'cut')
      const keyName = requireKeyName(positional[1], 'cut')
      const operator = requireCutOperator(positional[2])
      const expected = positional[3]
      const out = []

      for (const entry of list) {
        const actual = readKey(entry, keyName)
        let passes = false

        if (actual !== undefined) {
          if (operator === '>') passes = actual > expected
          else if (operator === '>=') passes = actual >= expected
          else if (operator === '<') passes = actual < expected
          else passes = actual <= expected
        }

        if (!passes) break
        out.push(entry)
      }

      return out
    },
    exact_length: ({ positional }) => {
      const lengthValue = positional[0]
      const schema = positional[1]
      const expectedLength = Number(lengthValue)
      if (!Number.isInteger(expectedLength)) {
        collectionError('INVALID_CONSTRAINT_ARGUMENT', `exact_length() requires an integer length as first argument; received "${lengthValue}".`)
      }
      if (!schema) {
        collectionError('INVALID_CONSTRAINT_ARGUMENT', 'exact_length() requires a schema as second argument.')
      }
      return {
        __nextv_constraint__: 'exact_length',
        expectedLength,
        schema,
      }
    },
    file: ({ positional }) => {
      const pathRaw = String(positional[0] ?? '')
      const absolute = resolve(baseDir, pathRaw)
      return readFileSync(absolute, 'utf8')
    },
    input: async ({ positional }) => {
      const prompt = positional[0] == null ? '' : String(positional[0])
      if (typeof options.requestInput === 'function') {
        const response = await options.requestInput({ prompt, event: runtimeContext.event })
        await runtimeContext.emitEvent({
          type: 'input',
          value: response == null ? '' : response,
          source: 'request_input',
          eventType: 'input',
        })
        return response == null ? '' : response
      }

      const fromEvent = defaultInputValue(runtimeContext.event)
      if (fromEvent == null) {
        throw nextvError({
          line: runtimeContext.line,
          kind: 'runtime',
          code: 'INPUT_UNAVAILABLE',
          statement: runtimeContext.statement,
          message: 'input() requires either an event payload or a requestInput callback.',
        })
      }
      const eventType = isPlainObject(runtimeContext.event) ? String(runtimeContext.event.type ?? '') : ''
      const source = isPlainObject(runtimeContext.event)
        ? String(runtimeContext.event.source ?? 'external')
        : 'external'
      await runtimeContext.emitEvent({
        type: 'input',
        value: fromEvent,
        source,
        eventType,
      })
      return fromEvent
    },
    from_json: ({ positional }) => {
      const input = positional[0]
      if (typeof input !== 'string') {
        return input
      }

      const text = String(input).trim()
      if (!text) {
        throw nextvError({
          line: runtimeContext.line,
          kind: 'runtime',
          code: 'JSON_PARSE_ERROR',
          statement: runtimeContext.statement,
          message: 'from_json() received empty string input.',
        })
      }

      try {
        return JSON.parse(text)
      } catch (err) {
        throw nextvError({
          line: runtimeContext.line,
          kind: 'runtime',
          code: 'JSON_PARSE_ERROR',
          statement: runtimeContext.statement,
          message: `from_json() failed to parse JSON: ${String(err?.message ?? err)}`,
        })
      }
    },
    to_json: ({ positional }) => toJsonText(positional[0], runtimeContext, 'to_json()'),
    emit: ({ positional, named, line, statement }) => {
      const typeRaw = positional[0] ?? named?.type ?? named?.event ?? ''
      const signalType = String(typeRaw ?? '').trim()
      if (!signalType) {
        throw nextvError({
          line,
          kind: 'runtime',
          code: 'INVALID_EMIT_TYPE',
          statement,
          message: 'emit() requires a non-empty event type as first argument.',
        })
      }

      const value = positional.length >= 2 ? positional[1] : named?.value
      const roleWarning = getRoleWarningForEmit(runtimeContext.executionRole)
      if (roleWarning) {
        void runtimeContext.emitWarning({
          code: roleWarning.code,
          message: roleWarning.message,
          line,
          statement,
          functionName: 'emit',
        })
      }
      runtimeContext.enqueueSignal({
        type: signalType,
        value,
        line,
        statement,
      })
      return null
    },
    __nextv_for_validate_range: ({ positional }) => {
      const startValue = positional[0]
      const endValue = positional[1]
      const start = Number(startValue)
      const end = Number(endValue)
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw nextvError({
          line: runtimeContext.line,
          kind: 'runtime',
          code: 'INVALID_FOR_RANGE',
          statement: runtimeContext.statement,
          message: `For bounds must resolve to integers. Got "${startValue}" and "${endValue}".`,
        })
      }
      if (start > end) {
        throw nextvError({
          line: runtimeContext.line,
          kind: 'runtime',
          code: 'INVALID_FOR_RANGE',
          statement: runtimeContext.statement,
          message: 'For range start cannot be greater than end.',
        })
      }
      return true
    },
    tool: async ({ positional, named, state, event, locals, line, statement }) => {
      const toolName = String(positional[0] ?? named?.name ?? '').trim()
      if (!toolName) {
        runtimeUnavailable('TOOL_NAME_REQUIRED', 'tool() requires a tool name as first argument.')
      }
      if (typeof options.callTool !== 'function') {
        runtimeUnavailable('TOOL_CALL_UNAVAILABLE', `tool("${toolName}") is not available in this runtime.`)
      }

      const args = { ...named }
      delete args.name
      const toolMetadata = typeof options.getToolMetadata === 'function'
        ? (options.getToolMetadata(toolName) ?? null)
        : null
      const payload = {
        positional: positional.slice(1),
        named: args,
      }

      await runtimeContext.emitEvent({
        type: 'tool_call',
        tool: toolName,
        toolMetadata,
        args: payload,
      })

      const result = await options.callTool({
        name: toolName,
        args,
        positional: positional.slice(1),
        state,
        event,
        locals,
        line,
        statement,
      })

      await runtimeContext.emitEvent({
        type: 'tool_result',
        tool: toolName,
        toolMetadata,
        result,
      })

      return result
    },
    agent: async ({ positional, named, state, event, locals, line, statement, sourcePath, sourceLine }) => {
      const context = { line, statement }
      for (const key of Object.keys(named ?? {})) {
        if (AGENT_NAMED_ARG_ALLOWLIST.has(key)) continue
        throw nextvError({
          line,
          kind: 'runtime',
          code: 'INVALID_AGENT_ARGUMENT',
          statement,
          message: `agent() received unsupported named argument "${key}". Use: agent, prompt, instructions, messages, format, returns, validate, retry_on_contract_violation, on_contract_violation.`,
        })
      }

      const agentName = String(positional[0] ?? named?.agent ?? '').trim()
      const promptRaw = positional[1] ?? named?.prompt
      const prompt = coerceTextValue(promptRaw, context, 'agent() prompt').trim()
      const instructions = coerceTextValue(positional[2] ?? named?.instructions, context, 'agent() instructions').trim()
      const messages = normalizeAgentMessagesValue(named?.messages, context)
      const format = String(named?.format ?? '').trim().toLowerCase()

      if (!agentName) {
        runtimeUnavailable('AGENT_NAME_REQUIRED', 'agent() requires an agent profile name.')
      }
      if (!prompt && messages.length === 0) {
        runtimeUnavailable('AGENT_PROMPT_REQUIRED', 'agent() requires a prompt as second argument, or provide messages=... .')
      }
      if (format && !NEXTV_AGENT_OUTPUT_FORMATS.has(format)) {
        throw nextvError({
          line,
          kind: 'runtime',
          code: 'INVALID_AGENT_FORMAT',
          statement,
          message: `agent() format must be one of json, text, or code; received "${format}".`,
        })
      }

      const returns = normalizeAgentReturnsValue(named?.returns ?? null, context)
      const validateRaw = String(named?.validate ?? '').trim().toLowerCase()
      if (validateRaw && validateRaw !== 'strict' && validateRaw !== 'coerce') {
        throw nextvError({
          line,
          kind: 'runtime',
          code: 'INVALID_AGENT_VALIDATE',
          statement,
          message: `agent() validate must be "strict" or "coerce"; received "${validateRaw}".`,
        })
      }
      const validate = returns != null ? (validateRaw || 'coerce') : validateRaw
      const effectiveFormat = returns != null ? '' : format

      const retryCountRaw = named?.retry_on_contract_violation
      const retryCount = Number.isInteger(retryCountRaw) ? retryCountRaw : 0
      if (retryCount < 0) {
        throw nextvError({
          line,
          kind: 'runtime',
          code: 'INVALID_AGENT_RETRY',
          statement,
          message: `agent() retry_on_contract_violation must be a non-negative integer; received ${retryCountRaw}.`,
        })
      }

      const onViolationExpr = named?.on_contract_violation

      if (typeof options.callAgent !== 'function') {
        runtimeUnavailable('AGENT_CALL_UNAVAILABLE', `agent("${agentName}") is not available in this runtime.`)
      }

      const callResult = await options.callAgent({
        agent: agentName,
        prompt,
        instructions,
        messages,
        format: effectiveFormat,
        returns,
        validate,
        retry_on_contract_violation: retryCount,
        on_contract_violation: onViolationExpr,
        state,
        event,
        locals,
        line,
        statement,
        sourcePath,
        sourceLine,
      })

      if (callResult && typeof callResult === 'object' && callResult.__nextv_contract_violation__ === true) {
        if (onViolationExpr) {
          const violationLocals = { ...locals, violation: callResult.violation }
          const violationContext = {
            ...runtimeContext,
            line,
            statement,
            locals: violationLocals,
            state,
            event,
            executionRole: 'agent',
          }
          await evaluateExpression(callResult.expression, violationContext)
        }
        return null
      }

      const normalizedCallResult = (
        callResult && typeof callResult === 'object' && !Array.isArray(callResult) && Object.prototype.hasOwnProperty.call(callResult, 'value')
          ? callResult
          : { value: callResult, metadata: null }
      )

      if (normalizedCallResult.metadata && Array.isArray(runtimeContext.agentCallMetadata)) {
        runtimeContext.agentCallMetadata.push({
          agent: agentName,
          line,
          statement,
          metadata: normalizedCallResult.metadata,
        })
      }

      return normalizedCallResult.value
    },
    script: async ({ positional, named, state, event, locals, line, statement }) => {
      const pathValue = String(positional[0] ?? named?.path ?? '').trim()
      if (!pathValue) {
        runtimeUnavailable('SCRIPT_PATH_REQUIRED', 'script() requires a script path as first argument.')
      }
      if (typeof options.callScript !== 'function') {
        runtimeUnavailable('SCRIPT_CALL_UNAVAILABLE', `script("${pathValue}") is not available in this runtime.`)
      }

      const result = await options.callScript({
        path: pathValue,
        state,
        event,
        locals,
        line,
        statement,
        executionRole: 'script',
        onEvent: runtimeContext.emitEvent,
      })

      if (isPlainObject(result?.state)) {
        Object.keys(runtimeContext.state).forEach((k) => delete runtimeContext.state[k])
        Object.assign(runtimeContext.state, result.state)
      }

      if (isPlainObject(result?.locals)) {
        Object.assign(runtimeContext.locals, result.locals)
      }

      if (result?.returnValue !== undefined) {
        validateOutputContract(result.returnValue)
      }

      return result?.returnValue ?? null
    },
    operator: async ({ positional, named, state, event, locals, line, statement }) => {
      const operatorId = String(positional[0] ?? named?.id ?? named?.operator ?? '').trim()
      if (!operatorId) {
        runtimeUnavailable('MISSING_ARGUMENT', 'operator() requires an operator id as first argument.')
      }
      if (typeof options.resolveOperatorPath !== 'function') {
        runtimeUnavailable('NOT_SUPPORTED', 'operator() is not supported in this runtime host.')
      }
      if (typeof options.callScript !== 'function') {
        runtimeUnavailable('SCRIPT_CALL_UNAVAILABLE', `operator("${operatorId}") requires script() host support.`)
      }

      const scriptPath = await options.resolveOperatorPath(operatorId)
      const scopedState = isPlainObject(state?.[operatorId]) ? cloneState(state[operatorId]) : {}
      const scopedEvent = positional[1] ?? named?.input ?? event

      const result = await options.callScript({
        path: scriptPath,
        state: scopedState,
        event: scopedEvent,
        locals,
        line,
        statement,
        executionRole: 'operator',
        onEvent: runtimeContext.emitEvent,
      })

      if (isPlainObject(result?.state)) {
        state[operatorId] = result.state
      } else {
        state[operatorId] = scopedState
      }

      if (result?.returnValue !== undefined) {
        validateOutputContract(result.returnValue)
      }

      return result?.returnValue ?? null
    },
    ...customFns,
  }
}

function normalizeRuntimeOptions(options = {}) {
  const runtimeOptions = { ...options }
  const adapter = isPlainObject(options.hostAdapter) ? options.hostAdapter : null
  runtimeOptions.executionRole = normalizeExecutionRole(options.executionRole, 'router')

  if (adapter) {
    if (runtimeOptions.callTool == null && typeof adapter.callTool === 'function') {
      runtimeOptions.callTool = adapter.callTool
    }
    if (runtimeOptions.getToolMetadata == null && typeof adapter.getToolMetadata === 'function') {
      runtimeOptions.getToolMetadata = adapter.getToolMetadata
    }
    if (runtimeOptions.callAgent == null && typeof adapter.callAgent === 'function') {
      runtimeOptions.callAgent = adapter.callAgent
    }
    if (runtimeOptions.callScript == null && typeof adapter.callScript === 'function') {
      runtimeOptions.callScript = adapter.callScript
    }
    if (runtimeOptions.resolveOperatorPath == null && typeof adapter.resolveOperatorPath === 'function') {
      runtimeOptions.resolveOperatorPath = adapter.resolveOperatorPath
    }
    if (runtimeOptions.requestInput == null && typeof adapter.requestInput === 'function') {
      runtimeOptions.requestInput = adapter.requestInput
    }
    if (runtimeOptions.onEvent == null && typeof adapter.onEvent === 'function') {
      runtimeOptions.onEvent = adapter.onEvent
    }
  }

  return runtimeOptions
}

function resolveDeclaredEffectChannel(channelName, effectChannelsRaw) {
  if (!effectChannelsRaw || typeof effectChannelsRaw !== 'object' || Array.isArray(effectChannelsRaw)) {
    return null
  }

  const normalizedChannelName = String(channelName ?? '').trim()
  if (!normalizedChannelName) return null

  for (const [channelIdRaw, channelConfigRaw] of Object.entries(effectChannelsRaw)) {
    const channelId = String(channelIdRaw ?? '').trim()
    if (!channelId || channelId !== normalizedChannelName) continue

    if (!channelConfigRaw || typeof channelConfigRaw !== 'object' || Array.isArray(channelConfigRaw)) {
      return { id: channelId, config: {} }
    }

    return { id: channelId, config: channelConfigRaw }
  }

  return null
}

export async function runNextVScript(source, options = {}) {
  const runtimeOptions = normalizeRuntimeOptions(options)
  const statements = parseNextVScript(source, { baseDir: runtimeOptions.baseDir })
  const instructions = compileAST(statements, {
    strict: runtimeOptions.strict === true,
    errorFactory: nextvError,
  })

  // Emit event contract warnings as runtime warning events.
  const runtimeDeclaredExternals = Array.isArray(runtimeOptions.declaredExternals)
    ? runtimeOptions.declaredExternals
    : []
  if (typeof runtimeOptions.onEvent === 'function' && runtimeDeclaredExternals.length >= 0) {
    try {
      const contractGraph = extractEventGraph(instructions, { declaredExternals: runtimeDeclaredExternals })
      for (const cw of contractGraph.contractWarnings) {
        await runtimeOptions.onEvent({
          type: 'warning',
          severity: 'warning',
          code: cw.code,
          eventType: cw.eventType,
          message: cw.message,
          timestamp: isoNow(),
        })
      }
    } catch {
      // Contract warning extraction is best-effort; never fail script execution.
    }
  }

  const maxSteps = runtimeOptions.maxSteps ?? DEFAULT_MAX_STEPS
  const maxQueuedSignals = runtimeOptions.maxQueuedSignals ?? maxSteps
  const state = cloneState(runtimeOptions.state)
  const locals = isPlainObject(runtimeOptions.locals) ? { ...runtimeOptions.locals } : {}
  const initialEvent = runtimeOptions.event ?? null
  const executionRole = normalizeExecutionRole(runtimeOptions.executionRole, 'router')
  let activeEvent = initialEvent
  const emittedEvents = []
  const warnings = []
  const agentCallMetadata = []
  const subscriptions = new Map()
  const signalQueue = []
  let eventSequence = 0

  const emitEvent = async (payload, meta = {}) => {
    if (!isPlainObject(payload)) return
    eventSequence += 1
    const eventRecord = {
      ...payload,
      executionRole: payload.executionRole ?? executionRole,
      timestamp: payload.timestamp ?? isoNow(),
      step: meta.step,
      line: meta.line,
      sequence: eventSequence,
    }
    emittedEvents.push(eventRecord)
    if (eventRecord.type === 'warning') {
      warnings.push(eventRecord)
    }
    if (typeof runtimeOptions.onEvent === 'function') {
      await runtimeOptions.onEvent(eventRecord)
    }
  }

  const enqueueSignal = (signal) => {
    if (!isPlainObject(signal)) return
    const hasPayload = Object.prototype.hasOwnProperty.call(signal, 'payload')
    const normalizedSignal = {
      type: String(signal.type ?? '').trim(),
      value: signal.value,
      payload: hasPayload ? signal.payload : null,
      line: signal.line,
      statement: signal.statement,
      source: String(signal.source ?? 'emit').trim() || 'emit',
    }
    signalQueue.push(normalizedSignal)

    if (runtimeOptions.emitTrace === true) {
      void emitEvent({
        type: 'signal_enqueue',
        signalType: normalizedSignal.type,
        value: normalizedSignal.value,
        queueLength: signalQueue.length,
      }, {
        line: normalizedSignal.line,
      })
    }
  }

  let pc = 0
  let steps = 0
  let stopped = false
  let returnValue = undefined
  let drainedSignals = 0

  const runInstructionRange = async (startPc, endPc, rangeEvent) => {
    const prevEvent = activeEvent
    activeEvent = rangeEvent
    let rangePc = startPc

    while (rangePc < endPc) {
      const instr = instructions[rangePc]
      pc = rangePc
      steps += 1
      if (steps > maxSteps) {
        throw nextvError({
          line: instr.line,
          kind: 'runtime',
          code: 'MAX_STEPS_EXCEEDED',
          statement: instr.statement,
          message: `Script exceeded max steps (${maxSteps}).`,
        })
      }

      const emitTrace = async (phase, extra = {}) => {
        if (runtimeOptions.emitTrace !== true) return
        const tracePayload = {
          type: 'trace',
          phase,
          pc,
          op: instr.op,
          line: instr.line,
          statement: instr.statement,
          ...extra,
        }

        if (runtimeOptions.emitTraceState === true) {
          tracePayload.snapshot = {
            state: cloneState(state),
            locals: cloneLocals(locals),
          }
        }

        await emitEvent(tracePayload, { step: steps, line: instr.line })
      }

      const ctx = {
        line: instr.line,
        statement: instr.statement,
        sourcePath: instr.sourcePath,
        sourceLine: instr.sourceLine,
        locals,
        state,
        event: activeEvent,
        executionRole,
        agentCallMetadata,
        emitStateUpdates: runtimeOptions.emitStateUpdates === true,
        emitEvent: (payload) => emitEvent(payload, { step: steps, line: instr.line }),
        emitWarning: (payload) => emitEvent({ type: 'warning', severity: 'warning', ...payload }, { step: steps, line: instr.line }),
        enqueueSignal,
        emitTraceCall: async (payload) => {
          if (runtimeOptions.emitTrace !== true) return
          const tracePayload = {
            type: 'trace_call',
            pc,
            op: instr.op,
            line: instr.line,
            statement: instr.statement,
            executionRole,
            ...payload,
          }
          if (runtimeOptions.emitTraceState === true) {
            tracePayload.snapshot = {
              state: cloneState(state),
              locals: cloneLocals(locals),
            }
          }
          await emitEvent(tracePayload, { step: steps, line: instr.line })
        },
        functions: {},
      }
      ctx.functions = buildFunctions(runtimeOptions, ctx)

      await emitTrace('before')

      if (instr.op === 'assign') {
        const value = await evaluateExpression(instr.src, ctx)
        await assignTarget(instr.dst, value, locals, state, ctx)
        await emitTrace('after', { result: value, dst: instr.dst })
        rangePc += 1
        continue
      }

      if (instr.op === 'tool_call' || instr.op === 'agent_call' || instr.op === 'script_call' || instr.op === 'operator_call' || instr.op === 'call') {
        const callName = instr.op === 'call'
          ? instr.name
          : (instr.op === 'tool_call'
            ? 'tool'
            : (instr.op === 'agent_call'
              ? 'agent'
              : (instr.op === 'script_call' ? 'script' : 'operator')))
        const result = await executeFunctionCall(callName, instr.args, ctx, 'opcode')
        if (Array.isArray(instr.dst)) {
          await assignTarget(instr.dst, result, locals, state, ctx)
        }
        await emitTrace('after', { result, dst: instr.dst })
        rangePc += 1
        continue
      }

      if (instr.op === 'emit') {
        const channelName = String(instr.format ?? '').trim()
        const declaredChannel = resolveDeclaredEffectChannel(channelName, runtimeOptions.effectChannels)
        const usesBuiltinOutputChannel = OUTPUT_FORMATS.has(channelName)
        if (!usesBuiltinOutputChannel && !declaredChannel) {
          const declaredNames = (
            runtimeOptions.effectChannels && typeof runtimeOptions.effectChannels === 'object' && !Array.isArray(runtimeOptions.effectChannels)
          )
            ? Object.keys(runtimeOptions.effectChannels)
            : []
          throw nextvError({
            line: instr.line,
            kind: 'runtime',
            code: 'INVALID_OUTPUT_FORMAT',
            statement: instr.statement,
            message: `Unsupported output channel "${channelName}". Supported built-ins: ${[...OUTPUT_FORMATS].join(', ')}${declaredNames.length > 0 ? `; declared channels: ${declaredNames.join(', ')}` : ''}.`,
          })
        }

        const effectiveFormat = usesBuiltinOutputChannel
          ? channelName
          : String(declaredChannel?.config?.format ?? 'json').trim() || 'json'
        const value = await evaluateExpression(instr.src, ctx)
        const roleWarning = getRoleWarningForOutput(executionRole, channelName)
        if (roleWarning) {
          await ctx.emitWarning({
            code: roleWarning.code,
            message: roleWarning.message,
            format: channelName,
          })
        }
        const outputPayload = {
          type: 'output',
          format: effectiveFormat,
          channel: channelName,
          content: formatOutputContent(value, effectiveFormat, ctx),
          payload: value,
        }
        if (declaredChannel?.id) {
          outputPayload.effectChannelId = declaredChannel.id
        }
        if (effectiveFormat === 'json' || effectiveFormat === 'interaction') {
          outputPayload.value = value
        }
        await ctx.emitEvent(outputPayload)
        await emitTrace('after', { result: value })
        rangePc += 1
        continue
      }

      if (instr.op === 'subscribe') {
        if (typeof instr.bodyStart !== 'number' || typeof instr.bodyEnd !== 'number') {
          throw nextvError({
            line: instr.line,
            kind: 'runtime',
            code: 'INVALID_SUBSCRIPTION_RANGE',
            statement: instr.statement,
            message: 'Subscription block has an invalid instruction range.',
          })
        }
        const handlers = subscriptions.get(instr.eventType) ?? []
        handlers.push({
          bodyStart: instr.bodyStart,
          bodyEnd: instr.bodyEnd,
          subscriptionKind: instr.subscriptionKind === 'external' ? 'external' : 'internal',
        })
        subscriptions.set(instr.eventType, handlers)
        await emitTrace('after', {
          eventType: instr.eventType,
          subscriptionKind: instr.subscriptionKind === 'external' ? 'external' : 'internal',
          bodyStart: instr.bodyStart,
          bodyEnd: instr.bodyEnd,
        })
        rangePc += 1
        continue
      }

      if (instr.op === 'branch') {
        const condition = await evaluateExpression(instr.cond, {
          ...ctx,
          allowUndefinedPath: true,
        })
        const truthy = Boolean(condition)
        await emitTrace('after', {
          result: truthy,
          target: truthy ? (rangePc + 1) : instr.ifFalse,
        })
        rangePc = truthy ? (rangePc + 1) : instr.ifFalse
        continue
      }

      if (instr.op === 'jump') {
        await emitTrace('after', { target: instr.target })
        rangePc = instr.target
        continue
      }

      if (instr.op === 'stop') {
        stopped = true
        await emitTrace('after', { stopped: true })
        break
      }

      if (instr.op === 'return_val') {
        returnValue = await evaluateExpression(instr.src, ctx)
        await emitTrace('after', { result: returnValue })
        break
      }

      throw nextvError({
        line: instr.line,
        kind: 'runtime',
        code: 'UNKNOWN_IR_OPCODE',
        statement: instr.statement,
        message: `Unknown IR opcode "${instr.op}".`,
      })
    }

    activeEvent = prevEvent
  }

  await runInstructionRange(0, instructions.length, initialEvent)

  // Optionally emit a startup signal once per host lifecycle (for example `init`).
  // Hosts control the one-time policy; runtime guarantees ordering before external dispatch.
  const autoInitSignalType = String(runtimeOptions.autoInitSignalType ?? '').trim()
  if (autoInitSignalType) {
    enqueueSignal({
      type: autoInitSignalType,
      value: runtimeOptions.autoInitSignalValue ?? null,
      source: 'runtime_init',
    })
  }

  // Auto-bind initial host event to external subscriptions so scripts no longer
  // require manual `if event.type == ... then emit(...)` ingress boilerplate.
  if (isPlainObject(initialEvent)) {
    const initialType = String(initialEvent.type ?? '').trim()
    if (initialType) {
      const handlers = subscriptions.get(initialType) ?? []
      const hasExternalSubscription = handlers.some((h) => h?.subscriptionKind === 'external')
      const alreadyQueued = signalQueue.some((s) => String(s?.type ?? '').trim() === initialType)
      if (hasExternalSubscription && !alreadyQueued) {
        enqueueSignal({
          type: initialType,
          value: initialEvent.value,
          payload: Object.prototype.hasOwnProperty.call(initialEvent, 'payload')
            ? initialEvent.payload
            : null,
          source: 'external',
        })
      }
    }
  }

  while (!stopped && returnValue === undefined && signalQueue.length > 0) {
    const signal = signalQueue.shift()
    if (!signal?.type) continue

    drainedSignals += 1
    if (drainedSignals > maxQueuedSignals) {
      throw nextvError({
        line: signal.line,
        kind: 'runtime',
        code: 'MAX_SIGNAL_EVENTS_EXCEEDED',
        statement: signal.statement,
        message: `Signal queue exceeded max events (${maxQueuedSignals}).`,
      })
    }

    const handlers = subscriptions.get(signal.type) ?? []
    if (handlers.length === 0) continue

    if (runtimeOptions.emitTrace === true) {
      await emitEvent({
        type: 'signal_dispatch',
        signalType: signal.type,
        value: signal.value,
        handlers: handlers.length,
        queueLength: signalQueue.length,
      }, {
        line: signal.line,
      })
    }

    const signalEvent = {
      type: signal.type,
      value: signal.value,
      payload: Object.prototype.hasOwnProperty.call(signal, 'payload')
        ? signal.payload
        : null,
      source: signal.source ?? 'emit',
    }

    for (const handler of handlers) {
      await runInstructionRange(handler.bodyStart, handler.bodyEnd, signalEvent)
      if (stopped || returnValue !== undefined) break
    }
  }

  return {
    state,
    locals,
    event: initialEvent,
    executionRole,
    warnings,
    stopped,
    returnValue,
    steps,
    agentCallMetadata,
    events: emittedEvents,
    ir: instructions,
  }
}

export function parseNextVScriptFromFile(filePath, options = {}) {
  const absolutePath = resolve(filePath)
  const source = readFileSync(absolutePath, 'utf8')
  const baseDir = options.baseDir ?? dirname(absolutePath)
  return parseNextVScript(source, { baseDir, filePath: absolutePath })
}

export async function runNextVScriptFromFile(filePath, options = {}) {
  const absolutePath = resolve(filePath)
  const source = readFileSync(absolutePath, 'utf8')
  const baseDir = options.baseDir ?? dirname(absolutePath)
  return runNextVScript(source, { ...options, baseDir })
}

export { NextVError }
