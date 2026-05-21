function normalizeProviders(providersRaw) {
  if (!Array.isArray(providersRaw)) return []
  return providersRaw.filter(Boolean)
}

async function resolveNamedRuntimeMetadata(providersList, name) {
  if (!name) return null

  for (const provider of providersList) {
    if (typeof provider === 'function') {
      const result = await provider(name)
      if (result && typeof result === 'object') {
        return result
      }
      continue
    }

    if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
      const entry = provider[name]
      if (!entry) continue
      if (typeof entry === 'function') {
        const result = await entry(name)
        if (result && typeof result === 'object') {
          return result
        }
        continue
      }
      if (typeof entry === 'object') {
        return entry
      }
    }
  }

  return null
}

function resolveNamedRuntimeCall(providersList, runtimeLabel, name, payload) {
  if (!name) {
    throw new Error(`${runtimeLabel} requires a non-empty name.`)
  }

  return (async () => {
    for (const provider of providersList) {
      if (typeof provider === 'function') {
        const result = await provider({ ...payload, name })
        if (result && typeof result === 'object' && result.handled === true) {
          return result.result
        }
        continue
      }

      if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
        const handler = provider[name]
        if (typeof handler === 'function') {
          const result = await handler({ ...payload, name })
          if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'handled')) {
            if (result.handled === false) {
              continue
            }
            if (result.handled === true) {
              return result.result
            }
          }
          return result
        }
      }
    }

    throw new Error(`${runtimeLabel} "${name}" is not available in this host yet.`)
  })()
}

export function createToolRuntime({ providers = [], metadataProviders = [] } = {}) {
  const providersList = normalizeProviders(providers)
  const metadataProvidersList = normalizeProviders(metadataProviders)

  return {
    call: async (payload = {}) => {
      const toolName = String(payload?.name ?? '').trim()
      return await resolveNamedRuntimeCall(providersList, 'Tool', toolName, payload)
    },
    getMetadata: async (nameRaw) => {
      const toolName = String(nameRaw ?? '').trim()
      return await resolveNamedRuntimeMetadata(metadataProvidersList, toolName)
    },
  }
}

export function createIngressConnectorRuntime({ connectors = [] } = {}) {
  const providersList = normalizeProviders(connectors)

  return {
    dispatch: async (payload = {}) => {
      const eventName = String(payload?.name ?? payload?.eventName ?? payload?.eventType ?? '').trim()
      return await resolveNamedRuntimeCall(providersList, 'Ingress connector', eventName, payload)
    },
  }
}

export function createEffectRealizerRuntime({ realizers = [] } = {}) {
  const providersList = normalizeProviders(realizers)

  return {
    realize: async (payload = {}) => {
      const effectName = String(payload?.name ?? payload?.effectName ?? payload?.channelId ?? payload?.effectChannelId ?? '').trim()
      return await resolveNamedRuntimeCall(providersList, 'Effect realizer', effectName, payload)
    },
  }
}