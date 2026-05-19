/**
 * storageCapability creates a storage capability that provides
 * tool-based access to data persistence (vector stores, file stores, etc.).
 *
 * Usage:
 *   host.attachCapability(storageCapability({ provider: localVectorProvider() }))
 */
export function storageCapability({ provider } = {}) {
  if (!provider) {
    throw new Error('storageCapability requires a provider object')
  }

  if (typeof provider !== 'object' || Array.isArray(provider)) {
    throw new Error('storageCapability provider must be an object')
  }

  return {
    toolProviders: [provider],
    // Storage typically doesn't require setup/teardown
    // Database connections are lazy-initialized on first tool call
  }
}
