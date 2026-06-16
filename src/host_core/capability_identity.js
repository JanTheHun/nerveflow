function normalizeName(value) {
  return String(value ?? '').trim()
}

export function parseCapabilityIdentity(nameRaw) {
  const name = normalizeName(nameRaw)
  if (!name) {
    return {
      name,
      isNamespaced: false,
      namespace: '',
      operation: '',
      isValid: false,
      reason: 'empty',
    }
  }

  const firstDot = name.indexOf('.')
  if (firstDot < 0) {
    return {
      name,
      isNamespaced: false,
      namespace: '',
      operation: '',
      isValid: true,
      reason: '',
    }
  }

  const lastDot = name.lastIndexOf('.')
  if (firstDot !== lastDot) {
    return {
      name,
      isNamespaced: true,
      namespace: '',
      operation: '',
      isValid: false,
      reason: 'segment_count',
    }
  }

  const namespace = name.slice(0, firstDot).trim()
  const operation = name.slice(firstDot + 1).trim()
  if (!namespace || !operation) {
    return {
      name,
      isNamespaced: true,
      namespace,
      operation,
      isValid: false,
      reason: 'empty_segment',
    }
  }

  return {
    name,
    isNamespaced: true,
    namespace,
    operation,
    isValid: true,
    reason: '',
  }
}

export function isCanonicalCapabilityIdentity(nameRaw) {
  const parsed = parseCapabilityIdentity(nameRaw)
  return parsed.isNamespaced && parsed.isValid
}

export function createCapabilityParseError(nameRaw) {
  const name = normalizeName(nameRaw)
  const err = new Error(
    name
      ? `Invalid capability identity "${name}". Expected namespace.operation.`
      : 'Invalid capability identity. Expected namespace.operation.',
  )
  err.code = 'INVALID_CAPABILITY_IDENTITY'
  return err
}