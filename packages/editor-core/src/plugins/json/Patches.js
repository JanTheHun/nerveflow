function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function applyTextPatch(surface, patch) {
  if (!surface || typeof surface.replaceRange !== 'function') {
    return { ok: false, reason: 'invalid-surface' }
  }
  if (!patch || typeof patch !== 'object') {
    return { ok: false, reason: 'invalid-patch' }
  }

  const text = surface.getText()
  const start = clamp(Number.isInteger(patch.start) ? patch.start : 0, 0, text.length)
  const end = clamp(Number.isInteger(patch.end) ? patch.end : start, 0, text.length)
  const replacement = typeof patch.text === 'string' ? patch.text : ''

  surface.replaceRange(start, end, replacement)

  if (patch.selection && Number.isInteger(patch.selection.start) && Number.isInteger(patch.selection.end)) {
    const max = surface.getText().length
    surface.setSelection(
      clamp(patch.selection.start, 0, max),
      clamp(patch.selection.end, 0, max),
    )
  }

  return { ok: true, value: surface.getText() }
}

export function createBooleanTogglePatch(text, start, end, currentValue) {
  const replacement = currentValue === 'true' ? 'false' : 'true'
  const normalizedText = typeof text === 'string' ? text : ''
  const max = normalizedText.length

  const safeStart = clamp(Number.isInteger(start) ? start : 0, 0, max)
  const safeEnd = clamp(Number.isInteger(end) ? end : safeStart, 0, max)
  const cursor = safeStart + replacement.length

  return {
    start: safeStart,
    end: safeEnd,
    text: replacement,
    selection: { start: cursor, end: cursor },
  }
}
