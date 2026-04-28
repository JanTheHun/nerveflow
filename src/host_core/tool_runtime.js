function normalizeProviders(providersRaw) {
  if (!Array.isArray(providersRaw)) return []
  return providersRaw.filter(Boolean)
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
          return await handler({ ...payload, name })
        }
      }
    }

    throw new Error(`${runtimeLabel} "${name}" is not available in this host yet.`)
  })()
}

export function createToolRuntime({ providers = [] } = {}) {
  const providersList = normalizeProviders(providers)

  return {
    call: async (payload = {}) => {
      const toolName = String(payload?.name ?? '').trim()
      return await resolveNamedRuntimeCall(providersList, 'Tool', toolName, payload)
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