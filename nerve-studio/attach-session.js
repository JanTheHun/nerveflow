export function validateAttachWsUrlOrThrow(wsUrlRaw) {
  const wsUrl = String(wsUrlRaw ?? '').trim()
  if (!wsUrl) {
    const err = new Error('attach mode requires attachWsUrl query parameter or NERVE_STUDIO_ATTACH_WS env')
    err.code = 'validation_error'
    throw err
  }

  let parsed
  try {
    parsed = new URL(wsUrl)
  } catch {
    const err = new Error(`attach ws url is invalid: ${wsUrl}`)
    err.code = 'validation_error'
    throw err
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    const err = new Error(`attach ws url must use ws:// or wss://: ${wsUrl}`)
    err.code = 'validation_error'
    throw err
  }

  return parsed.toString()
}

export function createAttachSession({ defaultWsUrl = '', createBridge } = {}) {
  if (typeof createBridge !== 'function') {
    throw new Error('createAttachSession: createBridge is required')
  }

  let attachedBridge = null
  let attachedBridgeUrl = ''

  function resolveAttachWsUrl(url) {
    return String(url?.searchParams?.get('attachWsUrl') ?? defaultWsUrl).trim()
  }

  function disconnect() {
    if (attachedBridge) {
      try {
        attachedBridge.disconnect()
      } catch {
        // best effort
      }
    }
    attachedBridge = null
    attachedBridgeUrl = ''
  }

  function getBridge(url, options = {}) {
    const required = options.required === true
    const attachWsUrl = resolveAttachWsUrl(url)
    if (!attachWsUrl) {
      if (!required) return null
      const err = new Error('attach mode requires attachWsUrl query parameter or NERVE_STUDIO_ATTACH_WS env')
      err.code = 'validation_error'
      throw err
    }

    const validatedUrl = validateAttachWsUrlOrThrow(attachWsUrl)
    if (attachedBridge && attachedBridgeUrl === validatedUrl) {
      return attachedBridge
    }

    disconnect()
    attachedBridge = createBridge(validatedUrl)
    attachedBridgeUrl = validatedUrl
    return attachedBridge
  }

  return {
    resolveAttachWsUrl,
    getBridge,
    disconnect,
  }
}