function normalizeProviders(providersRaw) {
  if (!Array.isArray(providersRaw)) return []
  return providersRaw.filter(Boolean)
}

export function createToolRuntime({ providers = [] } = {}) {
  const providersList = normalizeProviders(providers)

  return {
    call: async (payload = {}) => {
      const toolName = String(payload?.name ?? '').trim()
      if (!toolName) {
        throw new Error('tool runtime requires a non-empty tool name.')
      }

      for (const provider of providersList) {
        if (typeof provider === 'function') {
          const result = await provider({ ...payload, name: toolName })
          if (result && typeof result === 'object' && result.handled === true) {
            return result.result
          }
          continue
        }

        if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
          const handler = provider[toolName]
          if (typeof handler === 'function') {
            return await handler({ ...payload, name: toolName })
          }
        }
      }

      throw new Error(`Tool "${toolName}" is not available in this host yet.`)
    },
  }
}