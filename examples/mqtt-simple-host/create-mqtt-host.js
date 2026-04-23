import { randomUUID } from 'node:crypto'

import {
  NextVEventRunner,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  runNextVScriptFromFile,
  validateOutputContract,
} from '../../src/index.js'

import {
  areJsonStatesEqual,
  clearTimerHandles,
  createEventBus,
  createHostAdapter,
  createNextVRuntimeController,
  getDeclaredEffectChannels,
  getDeclaredExternals,
  hasMeaningfulNextVExecutionEvents,
  loadWorkspaceNextVConfig,
  normalizeEffectsPolicy,
  normalizeInputEvent,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  startTimerHandles,
  validateDeclaredEffectBindings,
} from '../../src/host_core/index.js'

import {
  buildHostProtocolEvent,
  buildHostProtocolResponse,
  validateHostProtocolCommand,
} from '../../src/host_core/protocol.js'

function mapRuntimeErrorCode(errorLike) {
  const message = String(errorLike?.message ?? errorLike ?? '').toLowerCase()
  if (message.includes('not active') || message.includes('not running')) return 'not_active'
  if (message.includes('already active')) return 'already_active'
  if (message.includes('not allowed') || message.includes('policy')) return 'policy_denied'
  if (message.includes('not available')) return 'unavailable'
  if (message.includes('not found')) return 'validation_error'
  if (message.includes('invalid') || message.includes('required')) return 'validation_error'
  return 'runtime_error'
}

function validateMqttEffectBinding({ channelId, channelConfig }) {
  const kind = String(channelConfig?.kind ?? '').trim().toLowerCase()
  if (!kind) return true

  if (kind !== 'mqtt') {
    return {
      ok: false,
      reason: 'unsupported_kind',
      message: `Declared effect channel "${channelId}" kind "${kind}" is not supported by mqtt-simple-host.`,
    }
  }

  const topic = String(channelConfig?.topic ?? '').trim()
  if (!topic) {
    return {
      ok: false,
      reason: 'missing_topic',
      message: `Declared effect channel "${channelId}" kind "mqtt" requires a non-empty "topic" field.`,
    }
  }

  return true
}

/**
 * Creates a wired MQTT host instance.
 *
 * This host demonstrates the multi-surface attachment pattern:
 * 
 * - One runtime session (execution authority)
 * - MQTT client acts as control + observability surface
 * - Event bus publishes to MQTT topics for other subscribed surfaces
 * - Each surface (MQTT client, web UI, effect driver) can attach/detach independently
 * 
 * In the multi-surface model:
 * - Control surface: Issues commands (start, stop, enqueue_event) via MQTT
 * - Observability surface: Subscribes to events via event bus → MQTT publish
 * - Effect surface: Observes execution events and realizes effects (optional, separate process)
 *
 * @param {object} mqttClient   - A connected mqtt client instance (or compatible mock).
 * @param {object} resolvers    - Path and file resolvers (same contract as ws-simple-host).
 * @param {object} [options]
 * @param {string} [options.sessionId]             - Session ID for event envelopes.
 * @param {string} [options.commandTopic]          - Topic to subscribe for commands.
 * @param {string} [options.eventTopicPrefix]      - Prefix for outbound event topics.
 * @param {string} [options.responseTopicPrefix]   - Prefix for outbound response topics.
 * @param {Set|null} [options.includeEvents]       - Set of event names to publish; null = all.
 * @param {Function|null} [options.eventPredicate] - Additional predicate (eventName, payload) => bool.
 * @param {boolean} [options.suppressTimerEvents]  - Suppress timer-sourced host events on MQTT egress.
 * @param {Function} [options.callAgent]           - Agent call implementation.
 * @param {string} [options.defaultModel]          - Default model name for agents.
 * @returns {{ runtimeController, eventBus, shutdown }}
 */
export function createMqttHost(mqttClient, resolvers, options = {}) {
  const {
    sessionId = `mqtt-${randomUUID()}`,
    commandTopic = 'nextv/command',
    eventTopicPrefix = 'nextv/event',
    responseTopicPrefix = 'nextv/response',
    includeEvents = null,
    eventPredicate = null,
    suppressTimerEvents = true,
    callAgent = async () => {
      throw new Error('agent transport is not configured for this host')
    },
    defaultModel = '',
  } = options

  const {
    resolveWorkspaceDirectory,
    loadWorkspaceConfig,
    resolveEntrypoint,
    resolveOptionalStatePath: _resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir: _resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath: _resolveDiscoveredStatePath,
    readJsonObjectFile,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    existsSync,
  } = resolvers

  // --- Filtering ---

  function shouldPublishEvent(eventName, payload) {
    if (includeEvents !== null && !includeEvents.has(eventName)) return false
    if (typeof eventPredicate === 'function') {
      return eventPredicate(eventName, payload) === true
    }
    return true
  }

  // --- Event bus and controller ---

  const eventBus = createEventBus()

  const runtimeController = createNextVRuntimeController({
    eventBus,
    createRunner: (opts) => new NextVEventRunner(opts),
    createHostAdapter,
    resolveWorkspaceDirectory,
    loadWorkspaceConfig,
    resolveEntrypoint,
    resolveOptionalStatePath: _resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir: _resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath: _resolveDiscoveredStatePath,
    readJsonObjectFile,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    existsSync,
    getDeclaredEffectChannels,
    getDeclaredExternals,
    validateEffectBindings: validateMqttEffectBinding,
    normalizeEffectsPolicy,
    validateDeclaredEffectBindings,
    areJsonStatesEqual,
    hasMeaningfulNextVExecutionEvents,
    normalizeInputEvent,
    startTimerHandles,
    clearTimerHandles,
    runNextVScriptFromFile,
    validateOutputContract,
    appendAgentFormatInstructions,
    normalizeAgentFormattedOutput,
    callAgent,
    defaultModel,
  })

  // --- MQTT publish helpers ---

  let eventSequence = 0

  function publishEvent(eventName, payload) {
    if (!shouldPublishEvent(eventName, payload)) return
    try {
      const envelope = buildHostProtocolEvent({
        eventName,
        payload,
        sessionId,
        sequence: eventSequence++,
        timestamp: new Date().toISOString(),
      })
      mqttClient.publish(
        `${eventTopicPrefix}/${eventName}`,
        JSON.stringify(envelope),
        { qos: 0, retain: false },
      )
    } catch {
      // Keep stream alive if one event cannot be projected.
    }
  }

  function publishResponse(requestId, envelope) {
    const topic = requestId
      ? `${responseTopicPrefix}/${requestId}`
      : responseTopicPrefix
    mqttClient.publish(topic, JSON.stringify(envelope), { qos: 0, retain: false })
  }

  function isTimerSourcedEvent(eventName, payload) {
    if (eventName === 'nextv_timer_pulse') return true
    const source = String(payload?.event?.source ?? '').trim()
    return source === 'timer'
  }

  // Bridge event bus → MQTT topics
  const eventHandler = (eventName, payload) => {
    if (suppressTimerEvents && isTimerSourcedEvent(eventName, payload)) return
    publishEvent(eventName, payload)
  }
  eventBus.subscribe(eventHandler)

  // --- Command handler ---

  async function handleCommand(rawBuffer) {
    let parsedRaw
    try {
      parsedRaw = JSON.parse(String(rawBuffer ?? '{}'))
    } catch {
      publishResponse(
        null,
        buildHostProtocolResponse({
          sessionId,
          ok: false,
          error: { code: 'validation_error', message: 'Command must be valid JSON.' },
          timestamp: new Date().toISOString(),
        }),
      )
      return
    }

    let command
    try {
      command = validateHostProtocolCommand(parsedRaw)
    } catch (err) {
      publishResponse(
        parsedRaw?.requestId,
        buildHostProtocolResponse({
          requestId: parsedRaw?.requestId,
          sessionId,
          ok: false,
          error: { code: 'validation_error', message: String(err?.message ?? err) },
          timestamp: new Date().toISOString(),
        }),
      )
      return
    }

    try {
      const payload = command.payload ?? {}
      let data

      if (command.type === 'start') {
        data = await runtimeController.start(payload)
      } else if (command.type === 'stop') {
        if (!runtimeController.isActive()) throw new Error('nextV runtime not active')
        data = { snapshot: runtimeController.stop() }
      } else if (command.type === 'enqueue_event') {
        data = runtimeController.enqueue(payload)
      } else if (command.type === 'snapshot') {
        const snapshot = runtimeController.getSnapshot()
        data = { running: snapshot?.running === true, snapshot }
      } else if (command.type === 'subscribe') {
        data = { subscribed: true, active: runtimeController.isActive() }
      } else if (command.type === 'unsubscribe') {
        data = { subscribed: false }
      } else {
        throw new Error(`Unsupported command type: ${command.type}`)
      }

      publishResponse(
        command.requestId,
        buildHostProtocolResponse({
          requestId: command.requestId,
          sessionId,
          ok: true,
          data,
          timestamp: new Date().toISOString(),
        }),
      )
    } catch (err) {
      publishResponse(
        command.requestId,
        buildHostProtocolResponse({
          requestId: command.requestId,
          sessionId,
          ok: false,
          error: { code: mapRuntimeErrorCode(err), message: String(err?.message ?? err) },
          timestamp: new Date().toISOString(),
        }),
      )
    }
  }

  // Wire MQTT command messages → handler
  mqttClient.on('message', (topic, buffer) => {
    if (topic === commandTopic) {
      handleCommand(buffer).catch((err) => {
        console.error('mqtt-simple-host unhandled command error:', err?.message ?? err)
      })
    }
  })

  function shutdown() {
    eventBus.unsubscribe(eventHandler)
  }

  return { runtimeController, eventBus, shutdown, sessionId, handleCommand }
}
