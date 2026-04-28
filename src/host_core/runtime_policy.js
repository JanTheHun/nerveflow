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

export function normalizeEffectsPolicy(rawPolicy) {
  const policy = String(rawPolicy ?? '').trim().toLowerCase()
  if (!policy) return 'warn'
  if (policy === 'warn' || policy === 'strict') return policy
  throw new Error('nextv.json#effectsPolicy must be either "warn" or "strict" when provided.')
}

export function validateDeclaredEffectBindings({
  declaredEffectChannels,
  validateEffectBindings,
} = {}) {
  const map = declaredEffectChannels && typeof declaredEffectChannels === 'object' && !Array.isArray(declaredEffectChannels)
    ? declaredEffectChannels
    : {}

  const issues = []
  for (const [channelId, channelConfigRaw] of Object.entries(map)) {
    const channelConfig = channelConfigRaw && typeof channelConfigRaw === 'object' && !Array.isArray(channelConfigRaw)
      ? channelConfigRaw
      : {}
    const kind = String(channelConfig.kind ?? '').trim()
    if (!kind) continue

    if (typeof validateEffectBindings !== 'function') {
      issues.push({
        channelId,
        kind,
        reason: 'missing_validator',
        message: `No host validator is configured for declared effect channel "${channelId}" (kind: "${kind}").`,
      })
      continue
    }

    try {
      const validation = validateEffectBindings({ channelId, channelConfig })
      if (validation === true || validation == null) continue

      if (typeof validation === 'string') {
        issues.push({
          channelId,
          kind,
          reason: 'unsupported_binding',
          message: validation,
        })
        continue
      }

      if (typeof validation === 'object' && !Array.isArray(validation)) {
        if (validation.ok === true) continue
        issues.push({
          channelId,
          kind,
          reason: String(validation.reason ?? 'unsupported_binding').trim() || 'unsupported_binding',
          message: String(validation.message ?? '').trim()
            || `Declared effect channel "${channelId}" (kind: "${kind}") is not supported by this host.`,
        })
        continue
      }

      if (validation === false) {
        issues.push({
          channelId,
          kind,
          reason: 'unsupported_binding',
          message: `Declared effect channel "${channelId}" (kind: "${kind}") is not supported by this host.`,
        })
      }
    } catch (err) {
      issues.push({
        channelId,
        kind,
        reason: 'validator_error',
        message: String(err?.message ?? `Host effect validator failed for "${channelId}".`),
      })
    }
  }

  return issues
}

export function validateRequiredCapabilityBindings({
  requiredCapabilities,
  configuredModules,
  validateCapabilityBindings,
} = {}) {
  const requiresMap = requiredCapabilities && typeof requiredCapabilities === 'object' && !Array.isArray(requiredCapabilities)
    ? requiredCapabilities
    : {}
  const modulesMap = configuredModules && typeof configuredModules === 'object' && !Array.isArray(configuredModules)
    ? configuredModules
    : {}

  const issues = []
  for (const [capabilityIdRaw, requirementRaw] of Object.entries(requiresMap)) {
    const capabilityId = String(capabilityIdRaw ?? '').trim()
    if (!capabilityId) continue

    const requirement = requirementRaw && typeof requirementRaw === 'object' && !Array.isArray(requirementRaw)
      ? requirementRaw
      : { required: Boolean(requirementRaw), provider: null }

    const isRequired = requirement.required !== false
    if (!isRequired) continue

    const preferredModuleId = String(requirement.provider ?? '').trim()
    const fallbackModuleId = preferredModuleId || capabilityId
    const resolvedModuleId = Object.prototype.hasOwnProperty.call(modulesMap, fallbackModuleId)
      ? fallbackModuleId
      : ''
    const moduleConfig = resolvedModuleId ? modulesMap[resolvedModuleId] : null

    if (!moduleConfig) {
      issues.push({
        capabilityId,
        moduleId: fallbackModuleId || null,
        reason: 'missing_binding',
        message: preferredModuleId
          ? `Required capability "${capabilityId}" expects module "${preferredModuleId}", but no such module binding is configured.`
          : `Required capability "${capabilityId}" is not bound to any configured module.`,
      })
      continue
    }

    if (typeof validateCapabilityBindings !== 'function') continue

    try {
      const validation = validateCapabilityBindings({
        capabilityId,
        requirement,
        configuredModules: modulesMap,
        moduleId: resolvedModuleId,
        moduleConfig,
      })

      if (validation === true || validation == null) continue

      if (typeof validation === 'string') {
        issues.push({
          capabilityId,
          moduleId: resolvedModuleId,
          reason: 'unsupported_binding',
          message: validation,
        })
        continue
      }

      if (typeof validation === 'object' && !Array.isArray(validation)) {
        if (validation.ok === true) continue
        issues.push({
          capabilityId,
          moduleId: resolvedModuleId,
          reason: String(validation.reason ?? 'unsupported_binding').trim() || 'unsupported_binding',
          message: String(validation.message ?? '').trim()
            || `Required capability "${capabilityId}" is not supported by configured module "${resolvedModuleId}".`,
        })
        continue
      }

      if (validation === false) {
        issues.push({
          capabilityId,
          moduleId: resolvedModuleId,
          reason: 'unsupported_binding',
          message: `Required capability "${capabilityId}" is not supported by configured module "${resolvedModuleId}".`,
        })
      }
    } catch (err) {
      issues.push({
        capabilityId,
        moduleId: resolvedModuleId,
        reason: 'validator_error',
        message: String(err?.message ?? `Host capability validator failed for "${capabilityId}".`),
      })
    }
  }

  return issues
}
