const DEFAULT_JOINER = '\n\n'
const DEFAULT_MAX_INCLUDE_BYTES = 512 * 1024
const DEFAULT_MAX_INCLUDE_COUNT = 64
const DEFAULT_MAX_TOTAL_INCLUDE_BYTES = 1024 * 1024

function hasOwn(target, key) {
  return Boolean(target && Object.prototype.hasOwnProperty.call(target, key))
}

function isIncludeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && hasOwn(value, 'include')
}

function parsePart(value, fieldName, partIndex = null) {
  const partLabel = partIndex == null ? fieldName : `${fieldName}[${partIndex}]`

  if (value == null) {
    return { type: 'text', text: '' }
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return { type: 'text', text: String(value) }
  }

  if (isIncludeObject(value)) {
    const includePath = String(value.include ?? '').trim()
    if (!includePath) {
      throw new Error(`${partLabel}.include must be a non-empty string.`)
    }
    return { type: 'include', path: includePath }
  }

  throw new Error(`${partLabel} must be a string, number, boolean, include object, or null.`)
}

export function normalizeComposedTextInput(value, { fieldName = 'value' } = {}) {
  if (value == null) {
    return {
      isStructured: false,
      parts: [],
    }
  }

  if (Array.isArray(value)) {
    return {
      isStructured: true,
      parts: value.map((entry, index) => parsePart(entry, fieldName, index)),
    }
  }

  if (isIncludeObject(value)) {
    return {
      isStructured: true,
      parts: [parsePart(value, fieldName)],
    }
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return {
      isStructured: false,
      parts: [parsePart(value, fieldName)],
    }
  }

  throw new Error(`${fieldName} must be a string, include object, or an array of those values.`)
}

export function materializeComposedTextInput(normalizedInput) {
  const normalized = normalizedInput && typeof normalizedInput === 'object'
    ? normalizedInput
    : { isStructured: false, parts: [] }

  if (!Array.isArray(normalized.parts) || normalized.parts.length === 0) {
    return ''
  }

  if (!normalized.isStructured) {
    const first = normalized.parts[0]
    if (first?.type === 'text') return String(first.text ?? '')
    if (first?.type === 'include') return { include: String(first.path ?? '') }
    return ''
  }

  return normalized.parts.map((part) => {
    if (part?.type === 'include') {
      return { include: String(part.path ?? '') }
    }
    return String(part?.text ?? '')
  })
}

export function hasMeaningfulComposedParts(parts = []) {
  if (!Array.isArray(parts)) return false
  return parts.some((part) => {
    if (!part || typeof part !== 'object') return false
    if (part.type === 'include') return String(part.path ?? '').trim().length > 0
    return String(part.text ?? '').trim().length > 0
  })
}

export function joinComposedTextParts(parts = [], joiner = DEFAULT_JOINER) {
  if (!Array.isArray(parts) || parts.length === 0) return ''
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'include') return ''
      return String(part.text ?? '')
    })
    .filter((entry) => entry !== '')
    .join(joiner)
}

export function renderComposedTextPreview(parts = []) {
  if (!Array.isArray(parts) || parts.length === 0) return ''
  return parts
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      if (part.type === 'include') return `@include(${String(part.path ?? '')})`
      return String(part.text ?? '')
    })
    .filter((entry) => entry !== '')
    .join(DEFAULT_JOINER)
}

export function appendTextToComposedInput(inputValue, extraText, { fieldName = 'value' } = {}) {
  const addition = String(extraText ?? '')
  if (!addition) return inputValue

  const normalized = normalizeComposedTextInput(inputValue, { fieldName })
  if (!normalized.isStructured) {
    const baseText = normalized.parts[0]?.type === 'text' ? String(normalized.parts[0].text ?? '') : ''
    return baseText ? `${baseText}${DEFAULT_JOINER}${addition}` : addition
  }

  const output = materializeComposedTextInput(normalized)
  if (!Array.isArray(output)) {
    return addition
  }
  output.push(addition)
  return output
}

export function extractComposedInput(payload, {
  legacyKey,
  partsKey,
  fieldName,
} = {}) {
  const source = payload && typeof payload === 'object' ? payload : {}
  const hasLegacy = hasOwn(source, legacyKey)
  const hasParts = hasOwn(source, partsKey)

  if (hasLegacy && hasParts) {
    throw new Error(`${legacyKey} and ${partsKey} cannot both be set.`)
  }

  const selectedKey = hasParts ? partsKey : legacyKey
  const selectedValue = selectedKey ? source[selectedKey] : undefined
  const normalized = normalizeComposedTextInput(selectedValue, {
    fieldName: selectedKey || fieldName || 'value',
  })

  return {
    ...normalized,
    hasLegacy,
    hasParts,
    selectedKey,
    value: materializeComposedTextInput(normalized),
  }
}

export function resolveComposedTextParts(parts = [], {
  workspaceDir,
  resolvePathFromBaseDirectory,
  readFileSync,
  maxIncludeBytes = DEFAULT_MAX_INCLUDE_BYTES,
  maxIncludeCount = DEFAULT_MAX_INCLUDE_COUNT,
  maxTotalIncludeBytes = DEFAULT_MAX_TOTAL_INCLUDE_BYTES,
  fieldName = 'value',
} = {}) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return {
      segments: [],
      includes: [],
      bytesRead: 0,
    }
  }

  if (!workspaceDir || typeof workspaceDir !== 'object' || !workspaceDir.absolutePath) {
    throw new Error(`${fieldName} include resolution requires workspaceDir.absolutePath.`)
  }
  if (typeof resolvePathFromBaseDirectory !== 'function') {
    throw new Error(`${fieldName} include resolution requires resolvePathFromBaseDirectory.`)
  }
  if (typeof readFileSync !== 'function') {
    throw new Error(`${fieldName} include resolution requires readFileSync.`)
  }

  const segments = []
  const includes = []
  let bytesRead = 0
  let includeCount = 0

  for (const [index, part] of parts.entries()) {
    if (!part || typeof part !== 'object') continue

    if (part.type === 'include') {
      includeCount += 1
      if (includeCount > maxIncludeCount) {
        throw new Error(`${fieldName} includes exceed the maximum allowed count (${maxIncludeCount}).`)
      }

      const includePath = String(part.path ?? '').trim()
      if (!includePath) {
        throw new Error(`${fieldName}[${index}] include path is empty.`)
      }

      let resolved
      try {
        resolved = resolvePathFromBaseDirectory(workspaceDir.absolutePath, includePath, 'editor')
      } catch (err) {
        throw new Error(`${fieldName}[${index}] include path is invalid: ${String(err?.message ?? err)}`)
      }

      let content
      try {
        content = readFileSync(resolved.absolutePath, 'utf8')
      } catch (err) {
        throw new Error(`${fieldName}[${index}] include could not be read: ${String(err?.message ?? err)}`)
      }

      const bytes = Buffer.byteLength(content, 'utf8')
      if (bytes > maxIncludeBytes) {
        throw new Error(`${fieldName}[${index}] include file is too large.`)
      }

      if (bytesRead + bytes > maxTotalIncludeBytes) {
        throw new Error(`${fieldName} includes exceed the maximum allowed total size (${maxTotalIncludeBytes} bytes).`)
      }

      bytesRead += bytes
      segments.push(content)
      includes.push(String(resolved.relativePath ?? includePath).replace(/\\/g, '/'))
      continue
    }

    segments.push(String(part.text ?? ''))
  }

  return {
    segments,
    includes,
    bytesRead,
  }
}

export function isComposedTextInputValue(value) {
  try {
    normalizeComposedTextInput(value)
    return true
  } catch {
    return false
  }
}
