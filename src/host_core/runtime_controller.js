export function buildInactiveSnapshot() {
  return {
    running: false,
    executionCount: 0,
    pendingEvents: 0,
    state: {},
    locals: {},
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
  toolRuntime = null,
  ingressRuntime = null,
  effectRuntime = null,
  callAgent,
  defaultModel = '',
}) {
  let nextVRunner = null
  let nextVTimerHandles = []
  let nextVWorkspaceDir = ''
  let nextVEntrypointPath = ''

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
    return snapshot
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
    const runtimeCallHooks = createHostAdapter({
      workspaceDir,
      workspaceConfig,
      callAgent,
      defaultModel,
      resolvePathFromBaseDirectory,
      existsSync,
      runNextVScriptFromFile,
      validateOutputContract,
      appendAgentFormatInstructions,
      normalizeAgentFormattedOutput,
      validateAgentReturnContract,
      buildAgentReturnContractGuidance,
      buildAgentRetryPrompt,
      toolRuntime,
    })
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
        declaredExternals: getDeclaredExternals(workspaceConfig),
        effectChannels: declaredEffectChannels,
        hostAdapter: runtimeCallHooks,
      },
      onEvent: ({ event, runtimeEvent, snapshot }) => {
        const eventSource = String(event?.source ?? '').trim()
        if (eventSource === 'timer' && suppressTimerNoOps) {
          const runtimeEventType = String(runtimeEvent?.type ?? '').trim()
          if (runtimeEventType !== 'output') return
        }
        eventBus.publish('nextv_runtime_event', { event, runtimeEvent, snapshot })
        const effectChannelId = String(runtimeEvent?.effectChannelId ?? '').trim()
        if (runtimeEvent?.type === 'output' && effectChannelId && effectRuntime && typeof effectRuntime.realize === 'function') {
          Promise
            .resolve()
            .then(async () => effectRuntime.realize({
              name: effectChannelId,
              effectName: effectChannelId,
              channelId: effectChannelId,
              effectChannelId,
              event,
              runtimeEvent,
              snapshot,
              workspaceDir: workspaceDir.relativePath,
              entrypointPath: entrypoint.relativePath,
            }))
            .then((result) => {
              eventBus.publish('nextv_effect_realized', {
                effectChannelId,
                result,
                event,
                runtimeEvent,
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
        eventBus.publish('nextv_execution', {
          event,
          result: {
            stopped: result?.stopped === true,
            steps: Number(result?.steps ?? 0),
            agentCalls: Array.isArray(result?.agentCallMetadata) ? result.agentCallMetadata : [],
          },
          events: Array.isArray(events) ? events : [],
          snapshot,
        })
      },
      onError: (err) => {
        eventBus.publish('nextv_error', {
          message: String(err?.message ?? 'Unknown nextV runtime error'),
          line: Number.isFinite(Number(err?.line)) ? Number(err.line) : null,
          sourcePath: String(err?.sourcePath ?? ''),
          sourceLine: Number.isFinite(Number(err?.sourceLine)) ? Number(err.sourceLine) : null,
          kind: String(err?.kind ?? ''),
          code: String(err?.code ?? ''),
          statement: String(err?.statement ?? ''),
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
        agents: workspaceConfig.agents.status,
        tools: workspaceConfig.tools.status,
        nextv: workspaceConfig.nextv.status,
        operators: workspaceConfig.operators.status,
        agentsSource: workspaceConfig.agents.source,
        toolsSource: workspaceConfig.tools.source,
        nextvSource: workspaceConfig.nextv.file,
        operatorsSource: workspaceConfig.operators.source,
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

  return {
    start,
    stop,
    enqueue,
    dispatchIngress,
    getSnapshot,
    getActiveSnapshot,
    isActive: () => Boolean(nextVRunner),
    getWorkspaceDir: () => nextVWorkspaceDir,
    getEntrypointPath: () => nextVEntrypointPath,
  }
}
