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

function expectedContractTypeName(schema) {
  if (schema === null) return 'any'
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

function fillFromContractSchema(schema) {
  if (schema === null) return null
  if (Array.isArray(schema)) return []
  if (isPlainObjectContract(schema)) {
    const result = {}
    for (const key of Object.keys(schema)) {
      result[key] = fillFromContractSchema(schema[key])
    }
    return result
  }
  return schema
}

function validateContractValue(value, schema, mode, path) {
  if (schema === null) return value

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
      if (mode === 'coerce') return fillFromContractSchema(schema)
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
        if (mode === 'coerce') {
          result[key] = fillFromContractSchema(fieldSchema)
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
  const validMode = mode === 'strict' ? 'strict' : 'coerce'
  return validateContractValue(output, contract, validMode, '')
}

export function buildAgentReturnContractGuidance(contract) {
  const contractJson = JSON.stringify(contract, null, 2)
  return `Return only valid JSON matching this structure:\n\n${contractJson}\n\nInclude all fields.\nReplace example values with actual values.\nDo not include commentary.`
}