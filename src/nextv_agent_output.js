export const NEXTV_AGENT_OUTPUT_FORMATS = new Set(['json', 'text', 'code'])

const FENCED_BLOCK_PATTERN = /```([A-Za-z0-9_-]+)?\n([\s\S]*?)```/g
const LEADING_FILLER_PATTERNS = [
  /^sure[,!.:\s-]*/i,
  /^here(?:'s| is)\s+/i,
  /^certainly[,!.:\s-]*/i,
  /^of course[,!.:\s-]*/i,
]

function toTrimmedString(value) {
  return String(value ?? '').trim()
}

function collectFencedBlocks(raw) {
  const blocks = []
  for (const match of raw.matchAll(FENCED_BLOCK_PATTERN)) {
    blocks.push({
      language: String(match[1] ?? '').trim().toLowerCase(),
      content: String(match[2] ?? '').trim(),
    })
  }
  return blocks
}

function extractFirstBalancedJsonSubstring(input) {
  let startIndex = -1
  let stack = []
  let inQuote = false
  let escaped = false

  for (let index = 0; index < input.length; index += 1) {
    const ch = input[index]

    if (startIndex === -1) {
      if (ch === '{' || ch === '[') {
        startIndex = index
        stack = [ch]
      }
      continue
    }

    if (escaped) {
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      continue
    }
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (inQuote) {
      continue
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch)
      continue
    }

    if (ch === '}' || ch === ']') {
      const last = stack.at(-1)
      const matches = (last === '{' && ch === '}') || (last === '[' && ch === ']')
      if (!matches) {
        startIndex = -1
        stack = []
        inQuote = false
        escaped = false
        continue
      }
      stack.pop()
      if (stack.length === 0) {
        return input.slice(startIndex, index + 1)
      }
    }
  }

  return ''
}

function stripMarkdownFormatting(text) {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
}

export function appendAgentFormatInstructions(prompt, format) {
  const promptText = toTrimmedString(prompt)
  const formatName = toTrimmedString(format).toLowerCase()
  if (!NEXTV_AGENT_OUTPUT_FORMATS.has(formatName)) {
    const err = new Error(`Unsupported nextV agent output format "${formatName}".`)
    err.code = 'INVALID_AGENT_FORMAT'
    throw err
  }

  const directives = {
    json: 'Return only valid JSON. Do not include explanation, markdown, or code fences.',
    text: 'Return only the final plain-text answer. Do not include markdown wrappers, code fences, or preamble.',
    code: 'Return only the final code result. Prefer a single fenced code block with no explanation before or after it.',
  }

  if (!promptText) {
    return directives[formatName]
  }

  return `${promptText}\n\nFormat contract: ${directives[formatName]}`
}

export function extractJsonOutput(raw) {
  const text = toTrimmedString(raw)
  if (!text) {
    const err = new Error('Received empty string input.')
    err.code = 'JSON_PARSE_ERROR'
    throw err
  }

  try {
    return JSON.parse(text)
  } catch {}

  const blocks = collectFencedBlocks(text)
  const jsonBlock = blocks.find((block) => block.language === 'json' && block.content)
  if (jsonBlock) {
    try {
      return JSON.parse(jsonBlock.content)
    } catch {}
  }

  const genericBlock = blocks.find((block) => block.content)
  if (genericBlock) {
    try {
      return JSON.parse(genericBlock.content)
    } catch {}
  }

  const balancedSubstring = extractFirstBalancedJsonSubstring(text)
  if (balancedSubstring) {
    try {
      return JSON.parse(balancedSubstring)
    } catch {}
  }

  const err = new Error('Failed to parse JSON output.')
  err.code = 'JSON_PARSE_ERROR'
  throw err
}

export function extractCodeOutput(raw) {
  const text = toTrimmedString(raw)
  if (!text) return ''

  const blocks = collectFencedBlocks(text)
  const firstBlock = blocks.find((block) => block.content)
  return firstBlock ? firstBlock.content : text
}

export function extractTextOutput(raw) {
  let text = toTrimmedString(raw)
  if (!text) return ''

  text = text.replace(FENCED_BLOCK_PATTERN, (_match, _language, content) => String(content ?? '').trim())
  text = stripMarkdownFormatting(text)

  let changed = true
  while (changed) {
    changed = false
    for (const pattern of LEADING_FILLER_PATTERNS) {
      const next = text.replace(pattern, '')
      if (next !== text) {
        text = next.trimStart()
        changed = true
      }
    }
  }

  return text.trim()
}

export function normalizeAgentFormattedOutput(raw, format) {
  const formatName = toTrimmedString(format).toLowerCase()
  if (!NEXTV_AGENT_OUTPUT_FORMATS.has(formatName)) {
    const err = new Error(`Unsupported nextV agent output format "${formatName}".`)
    err.code = 'INVALID_AGENT_FORMAT'
    throw err
  }

  if (formatName === 'json') {
    return extractJsonOutput(raw)
  }
  if (formatName === 'code') {
    return extractCodeOutput(raw)
  }
  return extractTextOutput(raw)
}
// --- Return contract engine ---

function isPlainObjectContract(val) {
  return val !== null && typeof val === 'object' && !Array.isArray(val)
}

function isStringEnumSchema(schema) {
  return Array.isArray(schema) && schema.length >= 2 && schema.every((item) => typeof item === 'string')
}

function enumExpectedName(schema) {
  return `enum(${schema.map((item) => JSON.stringify(item)).join(' | ')})`
}

function expectedContractTypeName(schema) {
  if (schema === null) return 'any'
  if (isStringEnumSchema(schema)) return enumExpectedName(schema)
  if (Array.isArray(schema)) return 'array'
  if (isPlainObjectContract(schema)) return 'object'
  return typeof schema
}

function actualContractTypeName(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (isPlainObjectContract(value)) return 'object'
  return typeof value
}

function makeContractViolation(path, expected, actual) {
  const displayPath = path || '<root>'
  const err = new Error(`Agent return contract violation at "${displayPath}": expected ${expected}, got ${actual}.`)
  err.code = 'AGENT_RETURN_CONTRACT_VIOLATION'
  err.path = path
  err.expected = expected
  err.actual = actual
  return err
}

function makeInvalidContract(path, reason) {
  const displayPath = path || '<root>'
  const err = new Error(`Invalid agent return contract at "${displayPath}": ${reason}.`)
  err.code = 'AGENT_RETURN_CONTRACT_INVALID'
  err.path = path
  err.reason = reason
  return err
}

function assertValidContractSchema(schema, path = '') {
  if (schema === null) return
  
  // Handle exact_length constraint
  if (schema && typeof schema === 'object' && schema.__nextv_constraint__ === 'exact_length') {
    if (typeof schema.expectedLength !== 'number' || !Number.isInteger(schema.expectedLength)) {
      throw makeInvalidContract(path, 'exact_length constraint requires expectedLength to be an integer')
    }
    if (!schema.schema) {
      throw makeInvalidContract(path, 'exact_length constraint requires a schema')
    }
    assertValidContractSchema(schema.schema, `${path}:exact_length`)
    return
  }
  
  if (isStringEnumSchema(schema)) {
    if (schema.includes('*')) {
      throw makeInvalidContract(path, 'wildcard enum value "*" is not supported')
    }
    return
  }
  if (Array.isArray(schema)) {
    if (schema.length === 0) return
    assertValidContractSchema(schema[0], `${path}[]`)
    return
  }
  if (isPlainObjectContract(schema)) {
    for (const key of Object.keys(schema)) {
      const fieldPath = path ? `${path}.${key}` : key
      assertValidContractSchema(schema[key], fieldPath)
    }
  }
}

function fillFromContractSchema(schema, path = '') {
  if (schema === null) return null
  
  // Constraints cannot be filled/coerced - they must fail
  if (schema && typeof schema === 'object' && schema.__nextv_constraint__ === 'exact_length') {
    throw makeContractViolation(path, `array with exactly ${schema.expectedLength} items`, 'undefined')
  }
  
  if (isStringEnumSchema(schema)) {
    throw makeContractViolation(path, enumExpectedName(schema), 'undefined')
  }
  if (Array.isArray(schema)) return []
  if (isPlainObjectContract(schema)) {
    const result = {}
    for (const key of Object.keys(schema)) {
      const fieldPath = path ? `${path}.${key}` : key
      result[key] = fillFromContractSchema(schema[key], fieldPath)
    }
    return result
  }
  return schema
}

function validateContractValue(value, schema, mode, path) {
  if (schema === null) return value

  // Handle exact_length constraint
  if (schema && typeof schema === 'object' && schema.__nextv_constraint__ === 'exact_length') {
    if (!Array.isArray(value)) {
      throw makeContractViolation(path, 'array', actualContractTypeName(value))
    }
    if (value.length !== schema.expectedLength) {
      throw makeContractViolation(
        path,
        `array with exactly ${schema.expectedLength} items`,
        `array with ${value.length} items`
      )
    }
    // Validate each item against the schema
    const itemSchema = Array.isArray(schema.schema) && schema.schema.length > 0 ? schema.schema[0] : null
    if (itemSchema !== null) {
      return value.map((item, i) => validateContractValue(item, itemSchema, mode, `${path}[${i}]`))
    }
    return value
  }

  if (isStringEnumSchema(schema)) {
    if (typeof value !== 'string') {
      throw makeContractViolation(path, enumExpectedName(schema), actualContractTypeName(value))
    }
    if (!schema.includes(value)) {
      throw makeContractViolation(path, enumExpectedName(schema), JSON.stringify(value))
    }
    return value
  }

  if (Array.isArray(schema)) {
    if (value === null || value === undefined) {
      if (mode === 'coerce') return []
      throw makeContractViolation(path, 'array', value === null ? 'null' : 'undefined')
    }
    if (!Array.isArray(value)) {
      throw makeContractViolation(path, 'array', actualContractTypeName(value))
    }
    if (schema.length === 0) return value
    const itemSchema = schema[0]
    return value.map((item, i) => validateContractValue(item, itemSchema, mode, `${path}[${i}]`))
  }

  if (isPlainObjectContract(schema)) {
    if (value === null || value === undefined) {
      if (mode === 'coerce') return fillFromContractSchema(schema, path)
      throw makeContractViolation(path, 'object', value === null ? 'null' : 'undefined')
    }
    if (!isPlainObjectContract(value)) {
      throw makeContractViolation(path, 'object', actualContractTypeName(value))
    }
    const result = { ...value }
    for (const key of Object.keys(schema)) {
      const fieldPath = path ? `${path}.${key}` : key
      const fieldSchema = schema[key]
      if (!(key in result) || result[key] === undefined) {
        if (isStringEnumSchema(fieldSchema)) {
          throw makeContractViolation(fieldPath, enumExpectedName(fieldSchema), 'undefined')
        }
        if (mode === 'coerce') {
          result[key] = fillFromContractSchema(fieldSchema, fieldPath)
        } else {
          throw makeContractViolation(fieldPath, expectedContractTypeName(fieldSchema), 'undefined')
        }
      } else {
        result[key] = validateContractValue(result[key], fieldSchema, mode, fieldPath)
      }
    }
    return result
  }

  if (typeof schema === 'string') {
    if (typeof value !== 'string') throw makeContractViolation(path, 'string', actualContractTypeName(value))
    return value
  }
  if (typeof schema === 'number') {
    if (typeof value !== 'number') throw makeContractViolation(path, 'number', actualContractTypeName(value))
    return value
  }
  if (typeof schema === 'boolean') {
    if (typeof value !== 'boolean') throw makeContractViolation(path, 'boolean', actualContractTypeName(value))
    return value
  }

  return value
}

export function validateAgentReturnContract(output, contract, mode) {
  assertValidContractSchema(contract)
  const validMode = mode === 'strict' ? 'strict' : 'coerce'
  return validateContractValue(output, contract, validMode, '')
}

function collectEnumConstraintLines(schema, path = '') {
  if (schema === null) return []
  
  // Handle exact_length constraint guidance
  if (schema && typeof schema === 'object' && schema.__nextv_constraint__ === 'exact_length') {
    const label = path || '<root>'
    const n = schema.expectedLength
    const lines = [`${label} must be an array with exactly ${n} item${n === 1 ? '' : 's'}. Return one entry for every input item provided. Do not skip or omit any.`]
    if (Array.isArray(schema.schema) && schema.schema.length > 0) {
      const nestedPath = path ? `${path}[]` : '[]'
      lines.push(...collectEnumConstraintLines(schema.schema[0], nestedPath))
    }
    return lines
  }
  
  if (isStringEnumSchema(schema)) {
    const label = path || '<root>'
    const values = schema.map((item) => `- ${item}`).join('\n')
    const hasOther = schema.includes('other')
    const fallbackRule = hasOther
      ? `If user input does not map to any listed value for ${label}, use "other".`
      : `If user input does not map to a listed value for ${label}, still choose one listed value. Never invent a new literal.`
    return [
      `${label} must be exactly one of:\n${values}\nReturn a single string literal value for ${label}. Do not return an array.\n${fallbackRule}\nBefore responding, verify ${label} is exactly one listed literal.`,
    ]
  }
  if (Array.isArray(schema)) {
    if (schema.length === 0) return []
    const nestedPath = path ? `${path}[]` : '[]'
    return collectEnumConstraintLines(schema[0], nestedPath)
  }
  if (isPlainObjectContract(schema)) {
    const lines = []
    for (const key of Object.keys(schema)) {
      const fieldPath = path ? `${path}.${key}` : key
      lines.push(...collectEnumConstraintLines(schema[key], fieldPath))
    }
    return lines
  }
  return []
}

export function buildAgentReturnContractGuidance(contract) {
  assertValidContractSchema(contract)
  const contractJson = JSON.stringify(contract, null, 2)
  const enumLines = collectEnumConstraintLines(contract)
  const enumSection = enumLines.length > 0 ? `\n\nEnum constraints:\n\n${enumLines.join('\n\n')}` : ''
  return `Return only valid JSON matching this structure:\n\n${contractJson}${enumSection}\n\nInclude all fields.\nReplace example values with actual values.\nDo not include commentary.`
}

export function buildAgentRetryPrompt(error) {
  if (!error || typeof error !== 'object') {
    return 'The previous response violated the return contract. Please try again with a valid response.'
  }

  const path = String(error?.path ?? '').trim()
  const expected = String(error?.expected ?? '').trim()
  const actual = String(error?.actual ?? '').trim()
  const errorMessage = String(error?.message ?? '').trim()

  // Specific feedback for exact_length cardinality violations
  const exactLengthMatch = expected.match(/^array with exactly (\d+) items?$/)
  if (exactLengthMatch) {
    const expectedCount = exactLengthMatch[1]
    const fieldLabel = path ? `Field "${path}"` : 'The result'
    return `The previous response violated the return contract:\n\n${fieldLabel} requires exactly ${expectedCount} items.\nYou returned: ${actual}.\nReturn one entry for every input item. Do not skip or omit any items.\n\nReturn exactly one valid JSON object matching the declared contract.`
  }

  if (!path || !expected || !actual) {
    return `The previous response violated the return contract:\n\n${errorMessage}\n\nReturn exactly one valid JSON object matching the declared contract.`
  }

  return `The previous response violated the return contract:\n\nField "${path}" must be ${expected}.\nYou returned: ${actual}\n\nReturn exactly one valid JSON object matching the declared contract.`
}