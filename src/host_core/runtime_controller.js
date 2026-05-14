export function buildInactiveSnapshot() {
  return {
    running: false,
    executionCount: 0,
    pendingEvents: 0,
    state: {},
    locals: {},
  }
}

export function buildInactiveCandidateStatus() {
  return {
    status: 'none',
    policy: 'warn',
    submittedAt: null,
    workspaceDir: '',
    entrypointPath: '',
    issues: [],
  }
}

export function createNextVRuntimeController({
  eventBus,
  createRunner,
  createHostAdapter,
  resolveWorkspaceDirectory,
  loadWorkspaceConfig,
  resolveEntrypoint,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  resolveDiscoveredStatePath,
  readJsonObjectFile,
  toWorkspaceDisplayPath,
  resolvePathFromBaseDirectory,
  existsSync,
  getDeclaredEffectChannels = () => ({}),
  getRequiredCapabilities = () => ({}),
  getConfiguredModules = () => ({}),
  validateEffectBindings = null,
  validateCapabilityBindings = null,
  getDeclaredExternals,
  normalizeEffectsPolicy = () => 'warn',
  validateDeclaredEffectBindings = () => [],
  validateRequiredCapabilityBindings = () => [],
  validateConfigReferences = () => [],
  validateNoForbiddenAgentFields = () => [],
  areJsonStatesEqual,
  hasMeaningfulNextVExecutionEvents,
  normalizeInputEvent,
  startTimerHandles,
  clearTimerHandles,
  runNextVScriptFromFile,
  validateOutputContract,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  validateAgentReturnContract = null,
  buildAgentReturnContractGuidance = null,
  buildAgentRetryPrompt = null,
  buildDecideGuidance = null,
  buildDecideRetryPrompt = null,
  validateDecideOutput = null,
  toolRuntime = null,
  ingressRuntime = null,
  effectRuntime = null,
  callAgent,
  defaultModel = '',
  slowAgentWarningMs = 15000,
  parallelMaxConcurrency = null,
}) {
  let nextVRunner = null
  let nextVTimerHandles = []
  let nextVWorkspaceDir = ''
  let nextVEntrypointPath = ''
  let nextVWorkspaceDirResolved = null
  let nextVWorkspaceConfig = null
  let nextVRuntimeCallHooks = null
  let nextVCandidateStatus = buildInactiveCandidateStatus()

  function normalizeRuntimeEventSourcePath(pathValue) {
    const raw = String(pathValue ?? '').trim()
    if (!raw) return ''
    if (raw.startsWith('(')) return raw
    try {
      return toWorkspaceDisplayPath(raw)
    } catch {
      return raw.replace(/\\/g, '/')
    }
  }

  function normalizeRuntimeEventForStudio(runtimeEvent) {
    if (!runtimeEvent || typeof runtimeEvent !== 'object') return runtimeEvent
    const normalizedSourcePath = normalizeRuntimeEventSourcePath(runtimeEvent.sourcePath)
    if (!normalizedSourcePath || normalizedSourcePath === runtimeEvent.sourcePath) return runtimeEvent
    return {
      ...runtimeEvent,
      sourcePath: normalizedSourcePath,
    }
  }

  function clearNextVTimers() {
    nextVTimerHandles = clearTimerHandles(nextVTimerHandles)
  }

  function startNextVTimers(runner, timers) {
    clearNextVTimers()
    nextVTimerHandles = startTimerHandles({
      runner,
      timers,
      isRunnerActive: (candidateRunner) => Boolean(nextVRunner && nextVRunner === candidateRunner),
      onPulse: (event) => eventBus.publish('nextv_timer_pulse', { event }),
    })
  }

  function stopRuntime() {
    clearNextVTimers()
    if (!nextVRunner) return null
    nextVRunner.stop()
    const snapshot = nextVRunner.getSnapshot()
    nextVRunner = null
    nextVRuntimeCallHooks = null
    nextVWorkspaceConfig = null
    nextVWorkspaceDirResolved = null
    nextVCandidateStatus = buildInactiveCandidateStatus()
    return snapshot
  }

  function summarizeWorkspaceConfig(workspaceConfig) {
    return {
      models: workspaceConfig?.models?.status || 'not-loaded',
      agents: workspaceConfig?.agents?.status || 'not-loaded',
      tools: workspaceConfig?.tools?.status || 'not-loaded',
      nextv: workspaceConfig?.nextv?.status || 'not-loaded',
      operators: workspaceConfig?.operators?.status || 'not-loaded',
      modelsSource: workspaceConfig?.models?.source || null,
      agentsSource: workspaceConfig?.agents?.source || null,
      toolsSource: workspaceConfig?.tools?.source || null,
      nextvSource: workspaceConfig?.nextv?.file || null,
      operatorsSource: workspaceConfig?.operators?.source || null,
    }
  }

  function collectCandidateIssues({ workspaceConfig, effectsPolicy }) {
    const declaredEffectChannels = getDeclaredEffectChannels(workspaceConfig)
    const requiredCapabilities = getRequiredCapabilities(workspaceConfig)
    const configuredModules = getConfiguredModules(workspaceConfig)

    const issues = []

    const effectBindingIssues = validateDeclaredEffectBindings({
      declaredEffectChannels,
      validateEffectBindings,
    })
    if (effectBindingIssues.length > 0) {
      issues.push({
        code: 'UNSUPPORTED_EFFECT_BINDING',
        message: `Detected ${effectBindingIssues.length} unsupported declared effect binding(s).`,
        severity: effectsPolicy === 'strict' ? 'error' : 'warning',
        details: effectBindingIssues,
      })
    }

    const capabilityBindingIssues = validateRequiredCapabilityBindings({
      requiredCapabilities,
      configuredModules,
      validateCapabilityBindings,
    })
    if (capabilityBindingIssues.length > 0) {
      issues.push({
        code: 'UNSUPPORTED_CAPABILITY_BINDING',
        message: `Detected ${capabilityBindingIssues.length} unsupported required capability binding(s).`,
        severity: effectsPolicy === 'strict' ? 'error' : 'warning',
        details: capabilityBindingIssues,
      })
    }

    const configRefIssues = validateConfigReferences(workspaceConfig)
    const transportIssues = configRefIssues.filter((entry) => entry.code === 'TRANSPORT_NOT_FOUND')
    if (transportIssues.length > 0) {
      issues.push({
        code: 'TRANSPORT_NOT_FOUND',
        message: `Detected ${transportIssues.length} transport configuration error(s).`,
        severity: 'error',
        details: transportIssues,
      })
    }
    const otherConfigRefIssues = configRefIssues.filter((entry) => entry.code !== 'TRANSPORT_NOT_FOUND')
    if (otherConfigRefIssues.length > 0) {
      issues.push({
        code: 'CONFIG_REFERENCE_ERROR',
        message: `Detected ${otherConfigRefIssues.length} config reference issue(s).`,
        severity: effectsPolicy === 'strict' ? 'error' : 'warning',
        details: otherConfigRefIssues,
      })
    }

    const forbiddenFieldIssues = validateNoForbiddenAgentFields(workspaceConfig)
    if (forbiddenFieldIssues.length > 0) {
      issues.push({
        code: 'FORBIDDEN_AGENT_FIELD',
        message: `Detected ${forbiddenFieldIssues.length} forbidden agent field(s).`,
        severity: effectsPolicy === 'strict' ? 'error' : 'warning',
        details: forbiddenFieldIssues,
      })
    }

    return issues
  }

  async function start(body = {}) {
    const rawWorkspaceDir = String(body.workspaceDir ?? '').trim()
    const requestedEntrypointPath = String(body.entrypointPath ?? '').trim()
    const hasRuntimePathInBody = body.runtimeStatePath != null || body.statePath != null
    const runtimePathFromBody = String(body.runtimeStatePath ?? body.statePath ?? '').trim()
    const runtimeInMemoryRequested = runtimePathFromBody.toLowerCase() === 'in-memory'
    const hasBaselinePathInBody = body.baselineStatePath != null
    const baselinePathFromBody = String(body.baselineStatePath ?? '').trim()
    const emitTrace = body.emitTrace === true
    const emitTraceState = emitTrace && body.emitTraceState === true

    const workspaceDir = resolveWorkspaceDirectory(rawWorkspaceDir)
    const workspaceConfig = loadWorkspaceConfig(workspaceDir)
    const entrypoint = resolveEntrypoint(workspaceDir, requestedEntrypointPath, workspaceConfig)
    const suppressTimerNoOps = workspaceConfig?.nextv?.config?.suppressTimerNoOps !== false
    const declaredEffectChannels = getDeclaredEffectChannels(workspaceConfig)
    const requiredCapabilities = getRequiredCapabilities(workspaceConfig)
    const configuredModules = getConfiguredModules(workspaceConfig)
    const effectsPolicy = normalizeEffectsPolicy(workspaceConfig?.nextv?.config?.effectsPolicy)
    const effectBindingIssues = validateDeclaredEffectBindings({
      declaredEffectChannels,
      validateEffectBindings,
    })
    if (effectBindingIssues.length > 0) {
      const message = `Detected ${effectBindingIssues.length} unsupported declared effect binding(s).`
      if (effectsPolicy === 'strict') {
        throw new Error(`${message} Set nextv.json#effectsPolicy to "warn" to allow startup.`)
      }
      eventBus.publish('nextv_warning', {
        code: 'UNSUPPORTED_EFFECT_BINDING',
        message,
        policy: effectsPolicy,
        issues: effectBindingIssues,
      })
    }

    const capabilityBindingIssues = validateRequiredCapabilityBindings({
      requiredCapabilities,
      configuredModules,
      validateCapabilityBindings,
    })
    if (capabilityBindingIssues.length > 0) {
      const message = `Detected ${capabilityBindingIssues.length} unsupported required capability binding(s).`
      if (effectsPolicy === 'strict') {
        throw new Error(`${message} Set nextv.json#effectsPolicy to "warn" to allow startup.`)
      }
      eventBus.publish('nextv_warning', {
        code: 'UNSUPPORTED_CAPABILITY_BINDING',
        message,
        policy: effectsPolicy,
        issues: capabilityBindingIssues,
      })
    }

    const configRefIssues = validateConfigReferences(workspaceConfig)
    if (configRefIssues.length > 0) {
      // TRANSPORT_NOT_FOUND is always fatal — it indicates broken config regardless of policy.
      const transportIssues = configRefIssues.filter((i) => i.code === 'TRANSPORT_NOT_FOUND')
      if (transportIssues.length > 0) {
        const details = transportIssues.map((i) => i.message).join('; ')
        throw new Error(`Transport configuration error(s): ${details}`)
      }
      const otherIssues = configRefIssues.filter((i) => i.code !== 'TRANSPORT_NOT_FOUND')
      if (otherIssues.length > 0) {
        const message = `Detected ${otherIssues.length} config reference issue(s).`
        if (effectsPolicy === 'strict') {
          throw new Error(`${message} Set nextv.json#effectsPolicy to "warn" to allow startup.`)
        }
        eventBus.publish('nextv_warning', {
          code: 'CONFIG_REFERENCE_ERROR',
          message,
          policy: effectsPolicy,
          issues: otherIssues,
        })
      }
    }

    const forbiddenFieldIssues = validateNoForbiddenAgentFields(workspaceConfig)
    if (forbiddenFieldIssues.length > 0) {
      const message = `Detected ${forbiddenFieldIssues.length} forbidden agent field(s).`
      if (effectsPolicy === 'strict') {
        throw new Error(`${message} Agents must not define transport or other execution parameters.`)
      }
      eventBus.publish('nextv_warning', {
        code: 'FORBIDDEN_AGENT_FIELD',
        message,
        policy: effectsPolicy,
        issues: forbiddenFieldIssues,
      })
    }

    const runtimePathFromConfig = String(
      workspaceConfig.nextv.config?.runtimeStatePath
      ?? workspaceConfig.nextv.config?.statePath
      ?? '',
    ).trim()
    const baselinePathFromConfig = String(workspaceConfig.nextv.config?.baselineStatePath ?? '').trim()
    const rawRuntimeStatePath = runtimeInMemoryRequested
      ? ''
      : (hasRuntimePathInBody ? runtimePathFromBody : runtimePathFromConfig)
    const rawBaselineStatePath = hasBaselinePathInBody ? baselinePathFromBody : baselinePathFromConfig

    let runtimeStatePath = ''
    if (rawRuntimeStatePath) {
      runtimeStatePath = resolveOptionalStatePath({
        rawStatePath: rawRuntimeStatePath,
        rawWorkspaceDir,
        workspaceDir,
        entrypoint,
        resolvePathFromBaseDirectory,
        existsSync,
      })
    }

    let baselineStatePath = ''
    if (rawBaselineStatePath) {
      baselineStatePath = resolveOptionalStatePath({
        rawStatePath: rawBaselineStatePath,
        rawWorkspaceDir,
        workspaceDir,
        entrypoint,
        resolvePathFromBaseDirectory,
        existsSync,
      })
    }

    const discoveryBaseDir = resolveStateDiscoveryBaseDir({ rawWorkspaceDir, workspaceDir, entrypoint })
    const discoveredRuntimePath = runtimeInMemoryRequested
      ? ''
      : (
        resolveDiscoveredStatePath(discoveryBaseDir, 'state.runtime.json', existsSync)
        || resolveDiscoveredStatePath(discoveryBaseDir, 'state.json', existsSync)
      )
    const discoveredBaselinePath = resolveDiscoveredStatePath(discoveryBaseDir, 'state.init.json', existsSync)

    const runtimeLoadPath = runtimeStatePath && existsSync(runtimeStatePath)
      ? runtimeStatePath
      : discoveredRuntimePath
    const baselineLoadPath = baselineStatePath && existsSync(baselineStatePath)
      ? baselineStatePath
      : discoveredBaselinePath

    if (runtimeLoadPath && baselineLoadPath && runtimeLoadPath === baselineLoadPath) {
      throw new Error('runtimeStatePath and baselineStatePath must resolve to different files')
    }

    let initialState = {}
    let stateLoadSource = 'empty'
    let stateLoadPath = ''

    if (runtimeLoadPath) {
      initialState = readJsonObjectFile(runtimeLoadPath)
      stateLoadSource = 'runtime'
      stateLoadPath = runtimeLoadPath
    } else if (baselineLoadPath) {
      initialState = readJsonObjectFile(baselineLoadPath)
      stateLoadSource = 'baseline'
      stateLoadPath = baselineLoadPath
    }

    const runtimeStateDisplayPath = 'in-memory'
    const baselineStateDisplayPath = baselineStatePath ? toWorkspaceDisplayPath(baselineStatePath) : ''
    const stateLoadDisplayPath = stateLoadPath ? toWorkspaceDisplayPath(stateLoadPath) : ''

    const stoppedSnapshot = stopRuntime()
    if (stoppedSnapshot) {
      eventBus.publish('nextv_stopped', { snapshot: stoppedSnapshot })
    }

    nextVWorkspaceDir = workspaceDir.relativePath
    nextVEntrypointPath = entrypoint.relativePath
    nextVWorkspaceDirResolved = workspaceDir
    nextVWorkspaceConfig = workspaceConfig
    const runtimeCallHooks = createHostAdapter({
      workspaceDir,
      workspaceConfig,
      getWorkspaceConfig: () => nextVWorkspaceConfig,
      callAgent,
      defaultModel,
      captureAgentRequestPayload: true,
      slowAgentWarningMs,
      onSlowAgentCallWarning: (payload) => {
        eventBus.publish('nextv_warning', {
          code: 'SLOW_AGENT_CALL',
          message: `agent("${payload.agent}") exceeded ${payload.thresholdMs}ms on model "${payload.model}".`,
          ...payload,
        })
      },
      resolvePathFromBaseDirectory,
      existsSync,
      runNextVScriptFromFile,
      validateOutputContract,
      appendAgentFormatInstructions,
      normalizeAgentFormattedOutput,
      validateAgentReturnContract,
      buildAgentReturnContractGuidance,
      buildAgentRetryPrompt,
      buildDecideGuidance,
      buildDecideRetryPrompt,
      validateDecideOutput,
      toolRuntime,
    })
    nextVRuntimeCallHooks = runtimeCallHooks

    // Preload phase — blocking, best-effort, must not abort startup
    const preloadMode = String(workspaceConfig?.runtime?.preload ?? 'none').trim()
    if ((preloadMode === 'marked' || preloadMode === 'all') && typeof callAgent.load === 'function') {
      const modelsMap = workspaceConfig?.models?.map ?? {}
      const transportsMap = workspaceConfig?.transports?.map ?? {}
      const candidates = Object.entries(modelsMap).filter(([, modelConfig]) => {
        if (preloadMode === 'marked' && modelConfig.preload !== true) return false
        const transportConfig = transportsMap[modelConfig.transport] ?? null
        return transportConfig?.capabilities?.supports_preload === true
      })
      for (const [modelLabel, modelConfig] of candidates) {
        const transportConfig = transportsMap[modelConfig.transport] ?? null
        const modelId = String(modelConfig.model ?? '').trim()
        if (!modelId) continue
        const startMs = Date.now()
        eventBus.publish('nextv_preload_start', { model: modelLabel, modelId })
        try {
          await callAgent.load({ model: modelId, transport: transportConfig })
          eventBus.publish('nextv_preload_success', { model: modelLabel, modelId, durationMs: Date.now() - startMs })
        } catch (err) {
          eventBus.publish('nextv_preload_error', { model: modelLabel, modelId, error: String(err?.message ?? err) })
          // must not crash startup
        }
      }
    }

    let lastObservedState = initialState

    nextVRunner = createRunner({
      entrypointPath: entrypoint.absolutePath,
      initialState,
      persistence: false,
      stopOnScriptStop: false,
      haltOnError: false,
      runOptions: {
        emitTrace,
        emitTraceState,
        parallelMaxConcurrency,
        declaredExternals: getDeclaredExternals(workspaceConfig),
        effectChannels: declaredEffectChannels,
        hostAdapter: runtimeCallHooks,
      },
      onEvent: ({ event, runtimeEvent, snapshot }) => {
        const eventSource = String(event?.source ?? '').trim()
        if (eventSource === 'timer' && suppressTimerNoOps) {
          const runtimeEventType = String(runtimeEvent?.type ?? '').trim()
          const allowTimerRuntimeEvent = (
            runtimeEventType === 'agent_call'
            || runtimeEventType === 'agent_result'
            || runtimeEventType === 'tool_call'
            || runtimeEventType === 'tool_result'
            || runtimeEventType === 'output'
            || runtimeEventType === 'warning'
          )
          if (!allowTimerRuntimeEvent) return
        }
        const runtimeEventForStudio = normalizeRuntimeEventForStudio(runtimeEvent)
        eventBus.publish('nextv_runtime_event', { event, runtimeEvent: runtimeEventForStudio, snapshot })
        const effectChannelId = String(runtimeEventForStudio?.effectChannelId ?? '').trim()
        if (runtimeEventForStudio?.type === 'output' && effectChannelId && effectRuntime && typeof effectRuntime.realize === 'function') {
          Promise
            .resolve()
            .then(async () => effectRuntime.realize({
              name: effectChannelId,
              effectName: effectChannelId,
              channelId: effectChannelId,
              effectChannelId,
              event,
              runtimeEvent: runtimeEventForStudio,
              snapshot,
              workspaceDir: workspaceDir.relativePath,
              entrypointPath: entrypoint.relativePath,
            }))
            .then((result) => {
              eventBus.publish('nextv_effect_realized', {
                effectChannelId,
                result,
                event,
                runtimeEvent: runtimeEventForStudio,
                snapshot,
              })
            })
            .catch((err) => {
              eventBus.publish('nextv_warning', {
                code: 'EFFECT_REALIZER_FAILED',
                message: `Effect realizer for channel "${effectChannelId}" failed: ${String(err?.message ?? err)}`,
                policy: effectsPolicy,
                effectChannelId,
                error: String(err?.message ?? err),
              })
            })
        }
      },
      onExecution: ({ event, result, events, snapshot }) => {
        const eventSource = String(event?.source ?? '').trim()
        const nextState = snapshot?.state ?? {}
        const stateChanged = !areJsonStatesEqual(lastObservedState, nextState)
        lastObservedState = nextState
        const executionIsMeaningful = (
          hasMeaningfulNextVExecutionEvents(events)
          || stateChanged
        )
        if (suppressTimerNoOps && eventSource === 'timer' && !executionIsMeaningful) {
          return
        }
        const normalizedEvents = Array.isArray(events)
          ? events.map((runtimeEvent) => normalizeRuntimeEventForStudio(runtimeEvent))
          : []
        eventBus.publish('nextv_execution', {
          event,
          result: {
            stopped: result?.stopped === true,
            steps: Number(result?.steps ?? 0),
            agentCalls: Array.isArray(result?.agentCallMetadata) ? result.agentCallMetadata : [],
          },
          events: normalizedEvents,
          snapshot,
        })
      },
      onError: (err) => {
        const normalizedErrorEvents = Array.isArray(err?.events)
          ? err.events.map((runtimeEvent) => normalizeRuntimeEventForStudio(runtimeEvent))
          : []
        const errorAgentCalls = Array.isArray(err?.agentCallMetadata) ? err.agentCallMetadata : []
        eventBus.publish('nextv_error', {
          message: String(err?.message ?? 'Unknown nextV runtime error'),
          line: Number.isFinite(Number(err?.line)) ? Number(err.line) : null,
          sourcePath: normalizeRuntimeEventSourcePath(err?.sourcePath),
          sourceLine: Number.isFinite(Number(err?.sourceLine)) ? Number(err.sourceLine) : null,
          kind: String(err?.kind ?? ''),
          code: String(err?.code ?? ''),
          statement: String(err?.statement ?? ''),
          result: {
            agentCalls: errorAgentCalls,
          },
          events: normalizedErrorEvents,
          snapshot: nextVRunner ? nextVRunner.getSnapshot() : null,
        })
      },
    })

    nextVRunner.start()
    startNextVTimers(nextVRunner, workspaceConfig.nextv.timers)
    const snapshot = nextVRunner.getSnapshot()

    const runtimeStartedPayload = {
      workspaceDir: workspaceDir.relativePath,
      entrypointPath: entrypoint.relativePath,
      statePath: runtimeStateDisplayPath,
      runtimeStatePath: runtimeStateDisplayPath,
      baselineStatePath: baselineStateDisplayPath || null,
      stateLoadSource,
      stateLoadPath: stateLoadDisplayPath || null,
      workspaceConfig: {
        models: workspaceConfig?.models?.status || 'not-loaded',
        agents: workspaceConfig?.agents?.status || 'not-loaded',
        tools: workspaceConfig?.tools?.status || 'not-loaded',
        nextv: workspaceConfig?.nextv?.status || 'not-loaded',
        operators: workspaceConfig?.operators?.status || 'not-loaded',
        modelsSource: workspaceConfig?.models?.source || null,
        agentsSource: workspaceConfig?.agents?.source || null,
        toolsSource: workspaceConfig?.tools?.source || null,
        nextvSource: workspaceConfig?.nextv?.file || null,
        operatorsSource: workspaceConfig?.operators?.source || null,
      },
      timers: {
        configured: Array.isArray(workspaceConfig.nextv.timers) ? workspaceConfig.nextv.timers.length : 0,
        source: workspaceConfig.nextv.timersSource || null,
      },
      trace: {
        enabled: emitTrace,
        includeState: emitTraceState,
      },
      effects: {
        policy: effectsPolicy,
        declared: Object.keys(declaredEffectChannels).length,
        unsupportedBindings: effectBindingIssues.length,
      },
      capabilities: {
        required: Object.values(requiredCapabilities).filter((entry) => entry?.required !== false).length,
        unsupportedBindings: capabilityBindingIssues.length,
        agentRouting: typeof runtimeCallHooks?.getAgentCapabilities === 'function'
          ? runtimeCallHooks.getAgentCapabilities()
          : null,
      },
      snapshot,
    }

    eventBus.publish('nextv_started', runtimeStartedPayload)

    return runtimeStartedPayload
  }

  function stop() {
    if (!nextVRunner) return null
    const snapshot = stopRuntime()
    eventBus.publish('nextv_stopped', { snapshot })
    return snapshot
  }

  function reloadConfig() {
    if (!nextVRunner) {
      throw new Error('nextV runtime not active')
    }

    const workspaceDir = nextVWorkspaceDirResolved || resolveWorkspaceDirectory(nextVWorkspaceDir)
    const workspaceConfig = loadWorkspaceConfig(workspaceDir)
    const effectsPolicy = normalizeEffectsPolicy(workspaceConfig?.nextv?.config?.effectsPolicy)

    const configRefIssues = validateConfigReferences(workspaceConfig)
    if (configRefIssues.length > 0) {
      const transportIssues = configRefIssues.filter((i) => i.code === 'TRANSPORT_NOT_FOUND')
      if (transportIssues.length > 0) {
        const details = transportIssues.map((i) => i.message).join('; ')
        throw new Error(`Transport configuration error(s): ${details}`)
      }
      if (effectsPolicy === 'strict') {
        throw new Error(`Detected ${configRefIssues.length} config reference issue(s). Set nextv.json#effectsPolicy to "warn" to allow reload.`)
      }
    }

    const forbiddenFieldIssues = validateNoForbiddenAgentFields(workspaceConfig)
    if (forbiddenFieldIssues.length > 0 && effectsPolicy === 'strict') {
      throw new Error(`Detected ${forbiddenFieldIssues.length} forbidden agent field(s). Agents must not define transport or other execution parameters.`)
    }

    nextVWorkspaceDirResolved = workspaceDir
    nextVWorkspaceConfig = workspaceConfig
    if (nextVRuntimeCallHooks && typeof nextVRuntimeCallHooks.clearConfigCache === 'function') {
      nextVRuntimeCallHooks.clearConfigCache()
    }

    const payload = {
      workspaceDir: workspaceDir.relativePath,
      entrypointPath: nextVEntrypointPath,
      workspaceConfig: summarizeWorkspaceConfig(workspaceConfig),
    }
    eventBus.publish('nextv_config_reloaded', payload)
    return payload
  }

  function submitCandidate() {
    if (!nextVRunner) {
      throw new Error('nextV runtime not active')
    }

    const workspaceDir = nextVWorkspaceDirResolved || resolveWorkspaceDirectory(nextVWorkspaceDir)
    const workspaceConfig = loadWorkspaceConfig(workspaceDir)
    const effectsPolicy = normalizeEffectsPolicy(workspaceConfig?.nextv?.config?.effectsPolicy)

    eventBus.publish('nextv_candidate_validation_started', {
      workspaceDir: workspaceDir.relativePath,
      entrypointPath: nextVEntrypointPath,
      policy: effectsPolicy,
    })

    const issues = collectCandidateIssues({ workspaceConfig, effectsPolicy })
    const rejected = issues.some((issue) => issue.severity === 'error')
    const payload = {
      status: rejected ? 'rejected' : 'promotable',
      policy: effectsPolicy,
      submittedAt: new Date().toISOString(),
      workspaceDir: workspaceDir.relativePath,
      entrypointPath: nextVEntrypointPath,
      workspaceConfig: summarizeWorkspaceConfig(workspaceConfig),
      issues,
    }
    nextVCandidateStatus = payload

    if (rejected) {
      eventBus.publish('nextv_candidate_validation_failed', payload)
    } else {
      eventBus.publish('nextv_candidate_promotable', payload)
    }

    return payload
  }

  function enqueue(rawEvent) {
    if (!nextVRunner) {
      throw new Error('nextV runtime not active')
    }

    const event = normalizeInputEvent(rawEvent)
    return enqueueNormalizedEvent(event)
  }

  function enqueueNormalizedEvent(event) {
    const ok = nextVRunner.enqueue(event)
    if (!ok) {
      throw new Error('nextV runtime is not running')
    }

    const snapshot = nextVRunner.getSnapshot()
    eventBus.publish('nextv_event_queued', { event, snapshot })
    return { event, snapshot }
  }

  async function dispatchIngress(rawIngressPayload = {}) {
    if (!nextVRunner) {
      throw new Error('nextV runtime not active')
    }
    if (!ingressRuntime || typeof ingressRuntime.dispatch !== 'function') {
      throw new Error('ingress runtime is not configured in this host')
    }

    const ingressName = String(
      rawIngressPayload?.name
      ?? rawIngressPayload?.ingressName
      ?? rawIngressPayload?.eventName
      ?? rawIngressPayload?.eventType
      ?? rawIngressPayload?.type
      ?? '',
    ).trim()
    if (!ingressName) {
      throw new Error('dispatchIngress requires a non-empty name/eventType')
    }

    const dispatched = await ingressRuntime.dispatch({
      ...rawIngressPayload,
      name: ingressName,
    })

    const dispatchedEvents = Array.isArray(dispatched) ? dispatched : [dispatched]
    const enqueued = []
    for (const nextRawEvent of dispatchedEvents) {
      if (!nextRawEvent || typeof nextRawEvent !== 'object') continue
      const normalized = normalizeInputEvent(nextRawEvent)
      enqueued.push(enqueueNormalizedEvent(normalized))
    }

    eventBus.publish('nextv_ingress_dispatched', {
      ingressName,
      input: rawIngressPayload,
      dispatchedCount: enqueued.length,
    })

    return {
      ingressName,
      dispatchedCount: enqueued.length,
      enqueued,
    }
  }

  function getSnapshot() {
    return nextVRunner ? nextVRunner.getSnapshot() : buildInactiveSnapshot()
  }

  function getActiveSnapshot() {
    return nextVRunner ? nextVRunner.getSnapshot() : null
  }

  function getDefinitionStatus() {
    return {
      active: {
        running: Boolean(nextVRunner),
        workspaceDir: nextVWorkspaceDir,
        entrypointPath: nextVEntrypointPath,
      },
      candidate: nextVCandidateStatus,
    }
  }

  return {
    start,
    stop,
    reloadConfig,
    submitCandidate,
    enqueue,
    dispatchIngress,
    getSnapshot,
    getActiveSnapshot,
    getDefinitionStatus,
    isActive: () => Boolean(nextVRunner),
    getWorkspaceDir: () => nextVWorkspaceDir,
    getEntrypointPath: () => nextVEntrypointPath,
  }
}
