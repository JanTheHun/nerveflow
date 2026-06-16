import { parseCapabilityIdentity } from './capability_identity.js'

function normalizeProviders(providersRaw) {
  if (!Array.isArray(providersRaw)) return []
  return providersRaw.filter(Boolean)
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function getNamespaceProvider(provider) {
  if (!isPlainObject(provider)) return null
  const namespace = String(provider.namespace ?? '').trim()
  if (!namespace) return null
  const tools = provider.tools
  if (!isPlainObject(tools)) return null
  return { namespace, tools }
}

function createCapabilityRegistrationError(message, code = 'CAPABILITY_ALREADY_REGISTERED') {
  const err = new Error(message)
  err.code = code
  return err
}

function validateToolProviderRegistrations(providersList) {
  const registeredCanonicalNames = new Map()
  const namespaceOwners = new Map()

  for (let index = 0; index < providersList.length; index += 1) {
    const provider = providersList[index]
    if (!isPlainObject(provider)) continue

    const namespacedProvider = getNamespaceProvider(provider)
    if (namespacedProvider) {
      const owner = namespaceOwners.get(namespacedProvider.namespace)
      if (owner != null && owner !== index) {
        throw createCapabilityRegistrationError(
          `Capability namespace "${namespacedProvider.namespace}" is already registered by another provider.`,
        )
      }
      namespaceOwners.set(namespacedProvider.namespace, index)

      for (const [operation, handler] of Object.entries(namespacedProvider.tools)) {
        if (typeof handler !== 'function') continue
        const capabilityName = `${namespacedProvider.namespace}.${operation}`
        const parsed = parseCapabilityIdentity(capabilityName)
        if (!parsed.isValid || !parsed.isNamespaced) {
          throw createCapabilityRegistrationError(
            `Capability "${capabilityName}" is invalid. Expected namespace.operation.`,
            'INVALID_CAPABILITY_IDENTITY',
          )
        }

        const existingOwner = registeredCanonicalNames.get(capabilityName)
        if (existingOwner != null && existingOwner !== index) {
          throw createCapabilityRegistrationError(
            `Capability "${capabilityName}" is already registered by another provider.`,
          )
        }
        registeredCanonicalNames.set(capabilityName, index)
      }
      continue
    }

    for (const [name, entry] of Object.entries(provider)) {
      if (typeof entry !== 'function') continue

      const parsed = parseCapabilityIdentity(name)
      if (!parsed.isNamespaced) continue
      if (!parsed.isValid) {
        throw createCapabilityRegistrationError(
          `Capability "${name}" is invalid. Expected namespace.operation.`,
          'INVALID_CAPABILITY_IDENTITY',
        )
      }

      const existingOwner = registeredCanonicalNames.get(name)
      if (existingOwner != null && existingOwner !== index) {
        throw createCapabilityRegistrationError(
          `Capability "${name}" is already registered by another provider.`,
        )
      }
      registeredCanonicalNames.set(name, index)
    }
  }
}

function extractProviderToolNames(provider) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return []

  const namespacedProvider = getNamespaceProvider(provider)
  if (namespacedProvider) {
    return Object.keys(namespacedProvider.tools)
      .filter((operation) => {
        const entry = namespacedProvider.tools[operation]
        return typeof entry === 'function'
      })
      .map((operation) => `${namespacedProvider.namespace}.${operation}`)
  }

  const directNames = Object.keys(provider)
    .filter((name) => {
      const entry = provider[name]
      return typeof entry === 'function'
    })

  return directNames
}

async function listAvailableToolNames(providersList, metadataProvidersList) {
  const names = new Set()

  for (const provider of providersList) {
    for (const name of extractProviderToolNames(provider)) {
      names.add(name)
    }
  }

  for (const provider of metadataProvidersList) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) continue
    for (const name of Object.keys(provider)) {
      if (!name) continue
      names.add(name)
    }
  }

  return [...names].sort()
}

async function collectToolNamesFromEnumerators(enumeratorsList) {
  const names = new Set()

  for (const enumerator of enumeratorsList) {
    if (typeof enumerator !== 'function') continue
    try {
      const discovered = await enumerator()
      if (!Array.isArray(discovered)) continue
      for (const nameRaw of discovered) {
        const name = String(nameRaw ?? '').trim()
        if (!name) continue
        names.add(name)
      }
    } catch {
      // Enumerator failures should not fail global tool discovery.
    }
  }

  return [...names]
}

async function resolveNamedRuntimeMetadata(providersList, name) {
  if (!name) return null

  const parsedName = parseCapabilityIdentity(name)

  for (const provider of providersList) {
    if (typeof provider === 'function') {
      const result = await provider(name)
      if (result && typeof result === 'object') {
        return result
      }
      continue
    }

    if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
      const namespacedProvider = getNamespaceProvider(provider)
      if (namespacedProvider && parsedName.isNamespaced && parsedName.isValid) {
        if (namespacedProvider.namespace !== parsedName.namespace) continue
        const entry = namespacedProvider.tools[parsedName.operation]
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
        continue
      }

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

  const parsedName = parseCapabilityIdentity(name)
  if (parsedName.isNamespaced && !parsedName.isValid) {
    const err = new Error(`${runtimeLabel} "${name}" is invalid. Expected namespace.operation.`)
    err.code = 'INVALID_CAPABILITY_IDENTITY'
    throw err
  }

  return (async () => {
    let namespaceExists = false

    for (const provider of providersList) {
      if (typeof provider === 'function') {
        const result = await provider({ ...payload, name })
        if (result && typeof result === 'object' && result.handled === true) {
          return result.result
        }
        continue
      }

      if (provider && typeof provider === 'object' && !Array.isArray(provider)) {
        const namespacedProvider = getNamespaceProvider(provider)
        if (namespacedProvider && parsedName.isNamespaced && parsedName.isValid) {
          if (namespacedProvider.namespace !== parsedName.namespace) {
            continue
          }

          namespaceExists = true
          const handler = namespacedProvider.tools[parsedName.operation]
          if (typeof handler !== 'function') {
            continue
          }

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

        if (namespacedProvider && !parsedName.isNamespaced) {
          continue
        }

        if (namespacedProvider && parsedName.isNamespaced && parsedName.isValid && namespacedProvider.namespace === parsedName.namespace) {
          namespaceExists = true
        }

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

    if (parsedName.isNamespaced && parsedName.isValid) {
      const err = new Error(
        namespaceExists
          ? `Capability "${name}" was not found (operation missing).`
          : `Capability "${name}" was not found (namespace missing).`,
      )
      err.code = namespaceExists ? 'CAPABILITY_NOT_FOUND' : 'CAPABILITY_NAMESPACE_NOT_FOUND'
      throw err
    }

    throw new Error(`${runtimeLabel} "${name}" is not available in this host yet.`)
  })()
}

export function createToolRuntime({ providers = [], metadataProviders = [], enumerators = [], toolNameEnumerators = [] } = {}) {
  const providersList = normalizeProviders(providers)
  validateToolProviderRegistrations(providersList)
  const metadataProvidersList = normalizeProviders(metadataProviders)
  const enumeratorsList = normalizeProviders([...enumerators, ...toolNameEnumerators])

  return {
    call: async (payload = {}) => {
      const toolName = String(payload?.name ?? '').trim()
      return await resolveNamedRuntimeCall(providersList, 'Tool', toolName, payload)
    },
    getMetadata: async (nameRaw) => {
      const toolName = String(nameRaw ?? '').trim()
      return await resolveNamedRuntimeMetadata(metadataProvidersList, toolName)
    },
    listAvailable: async () => {
      const names = new Set(await listAvailableToolNames(providersList, metadataProvidersList))
      for (const name of await collectToolNamesFromEnumerators(enumeratorsList)) {
        names.add(name)
      }
      return [...names].sort()
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