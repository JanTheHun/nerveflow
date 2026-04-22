export function hasMeaningfulNextVExecutionEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return false

  for (const event of events) {
    const type = String(event?.type ?? '').trim()
    if (type === 'warning') {
      const warningCode = String(event?.code ?? '').trim().toUpperCase()
      if (warningCode === 'UNDECLARED_EXTERNAL' || warningCode === 'UNLISTENED_EXTERNAL') {
        continue
      }
      return true
    }

    if (
      type === 'state_update'
      || type === 'output'
      || type === 'tool_call'
      || type === 'tool_result'
      || type === 'input'
    ) {
      return true
    }
  }

  return false
}

export function areJsonStatesEqual(left, right) {
  try {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
  } catch {
    return false
  }
}
