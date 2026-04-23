/**
 * MQTT remote observability bridge for nerve-studio.
 *
 * When nerve-studio runs with `NERVE_STUDIO_REMOTE_MQTT` set, this module
 * connects to the specified MQTT broker and subscribes to the runtime event
 * topic published by a running mqtt-simple-host (or any compatible host).
 * Each received event envelope is forwarded into nerve-studio's in-process
 * eventBus so the SSE stream delivers it to the browser UI unchanged.
 *
 * This makes nerve-studio a read-only observability surface: the runtime is
 * owned by the remote host process; nerve-studio cannot start, stop, or
 * enqueue events against it.
 *
 * @param {object} options
 * @param {string} options.brokerUrl        - MQTT broker URL, e.g. 'mqtt://localhost:1883'
 * @param {string} [options.topicPrefix]    - Topic prefix for runtime events. Defaults to 'nextv/event'.
 *                                            The bridge subscribes to `${topicPrefix}/#`.
 * @param {object} options.eventBus         - nerve-studio's in-process event bus (createEventBus() instance).
 * @param {Function} [options.createClient] - Injectable MQTT client factory (url: string) => client.
 *                                            Must return an EventEmitter with `subscribe`, `on('message')`,
 *                                            `on('connect')`, `on('close')`, `on('error')`, and `end()`.
 *                                            Defaults to `mqtt.connect` from the mqtt package.
 * @returns {{ disconnect: () => void }}
 */
export function createMqttRemoteBridge({ brokerUrl, topicPrefix = 'nextv/event', eventBus, createClient }) {
  if (!brokerUrl || typeof brokerUrl !== 'string') {
    throw new Error('createMqttRemoteBridge: brokerUrl is required')
  }
  if (!eventBus || typeof eventBus.publish !== 'function') {
    throw new Error('createMqttRemoteBridge: eventBus with publish() is required')
  }

  if (typeof createClient !== 'function') {
    throw new Error(
      'createMqttRemoteBridge: createClient is required. ' +
      'Pass `(url) => mqttPackage.connect(url)` from the mqtt package.',
    )
  }

  const wildcardTopic = `${topicPrefix}/#`
  const client = createClient(brokerUrl)

  client.on('connect', () => {
    console.log(`[nerve-studio] Remote MQTT bridge connected to ${brokerUrl}`)
    client.subscribe(wildcardTopic, (err) => {
      if (err) {
        console.error(`[nerve-studio] Remote MQTT bridge failed to subscribe to ${wildcardTopic}:`, err.message)
      } else {
        console.log(`[nerve-studio] Remote MQTT bridge subscribed to ${wildcardTopic}`)
      }
    })
  })

  client.on('message', (_topic, messageBuffer) => {
    let envelope
    try {
      envelope = JSON.parse(messageBuffer.toString('utf8'))
    } catch {
      // Unparseable message — skip silently
      return
    }

    const eventName = envelope?.eventName
    const payload = envelope?.payload

    if (typeof eventName !== 'string' || !eventName) {
      // Not a valid event envelope — skip
      return
    }

    try {
      eventBus.publish(eventName, payload ?? null)
    } catch {
      // Event bus errors are non-fatal for the bridge
    }
  })

  client.on('close', () => {
    console.log('[nerve-studio] Remote MQTT bridge disconnected')
  })

  client.on('error', (err) => {
    console.error('[nerve-studio] Remote MQTT bridge error:', err.message)
  })

  return {
    disconnect() {
      client.end()
    },
  }
}
