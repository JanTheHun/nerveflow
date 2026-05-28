import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  detectCycles,
  extractEventGraph,
  NextVEventRunner,
  appendAgentFormatInstructions,
  buildAgentReturnContractGuidance,
  buildAgentRetryPrompt,
  buildDecideGuidance,
  buildDecideRetryPrompt,
  listNextVScriptDependencyFilesFromFile,
  normalizeAgentFormattedOutput,
  parseNextVScript,
  runNextVScriptFromFile,
  validateAgentReturnContract,
  validateDecideOutput,
  validateOutputContract,
} from '../index.js'

import {
  areJsonStatesEqual,
  clearTimerHandles,
  createEventBus,
  createHostAdapter,
  createNextVRuntimeController,
  getConfiguredAgentProfiles,
  getConfiguredModelsMap,
  getConfiguredModules,
  getDeclaredEffectChannels,
  getDeclaredExternals,
  getRequiredCapabilities,
  hasMeaningfulNextVExecutionEvents,
  loadWorkspaceNextVConfig,
  normalizeEffectsPolicy,
  normalizeInputEvent,
  resolveDiscoveredStatePath,
  resolveOptionalStatePath,
  resolveStateDiscoveryBaseDir,
  startTimerHandles,
  validateConfigReferences,
  validateDeclaredEffectBindings,
  validateNoForbiddenAgentFields,
  validateRequiredCapabilityBindings,
} from '../host_core/index.js'
import {
  extractComposedInput,
  hasMeaningfulComposedParts,
  renderComposedTextPreview,
} from '../host_core/structured_inputs.js'

export function createRuntimeResolvers({ repoRoot }) {
  function toWorkspaceDisplayPath(absolutePath) {
    const rel = relative(repoRoot, absolutePath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return absolutePath
    return rel.replace(/\\/g, '/')
  }

  function readJsonObjectFile(filePath) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`JSON at ${toWorkspaceDisplayPath(filePath)} must be an object`)
    }
    return parsed
  }

  function resolveWorkspaceDirectory(inputPath) {
    const candidate = String(inputPath ?? '').trim()
    if (!candidate) {
      return { absolutePath: repoRoot, relativePath: '.' }
    }
    if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

    const absolutePath = resolve(repoRoot, candidate)
    const rel = relative(repoRoot, absolutePath)
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Path is outside workspace')
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Workspace directory not found: ${candidate.replace(/\\/g, '/')}`)
    }

    const relativePath = rel ? rel.replace(/\\/g, '/') : '.'
    return { absolutePath, relativePath }
  }

  function resolvePathFromBaseDirectory(baseDirectoryAbsolutePath, inputPath, kindRaw = 'editor') {
    const candidate = String(inputPath ?? '').trim()
    if (!candidate) throw new Error('filePath required')
    if (isAbsolute(candidate)) throw new Error('Only workspace-relative paths are allowed')

    const absolutePath = resolve(baseDirectoryAbsolutePath, candidate)
    const rel = relative(repoRoot, absolutePath)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Path is outside workspace')
    }

    const ext = extname(absolutePath).toLowerCase()
    if (kindRaw === 'script' && ext && ext !== '.nrv' && ext !== '.wfs') {
      throw new Error(`Unsupported extension '${ext}' for script`)
    }

    return { absolutePath, relativePath: rel.replace(/\\/g, '/') }
  }

  function resolveEntrypoint(workspaceDir, requestedEntrypoint, workspaceConfig) {
    const fromConfig = String(workspaceConfig?.nextv?.config?.entrypointPath ?? '').trim()
    const rawEntrypoint = String(requestedEntrypoint ?? '').trim() || fromConfig
    if (!rawEntrypoint) throw new Error('entrypointPath required (or set nerve.json/nextv.json entrypointPath)')

    const joined = join(
      workspaceDir.relativePath === '.' ? '' : workspaceDir.relativePath,
      rawEntrypoint,
    )
    const entrypoint = resolvePathFromBaseDirectory(repoRoot, joined.replace(/\\/g, '/'), 'script')
    if (!existsSync(entrypoint.absolutePath)) {
      throw new Error(`Entrypoint file not found: ${entrypoint.relativePath}`)
    }
    return entrypoint
  }

  return {
    repoRoot,
    resolveWorkspaceDirectory,
    loadWorkspaceConfig: (workspaceDir) =>
      loadWorkspaceNextVConfig({
        workspaceDir,
        toWorkspaceDisplayPath,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      }),
    resolveEntrypoint,
    resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath,
    readJsonObjectFile,
    toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory,
    existsSync,
  }
}

export function createRuntimeCore({
  sessionId = `runtime-${randomUUID()}`,
  callAgent = async () => {
    throw new Error('agent transport is not configured for runtime')
  },
  toolRuntime = null,
  ingressRuntime = null,
  effectRuntime = null,
  defaultModel = '',
  slowAgentWarningMs = 15000,
  parallelMaxConcurrency = null,
  resolvers,
} = {}) {
  if (!resolvers || typeof resolvers !== 'object') {
    throw new Error('createRuntimeCore requires resolvers')
  }

  const eventBus = createEventBus()
  let lifecycleState = 'idle'
  let lastError = ''

  const runtimeController = createNextVRuntimeController({
    eventBus,
    createRunner: (options) => new NextVEventRunner(options),
    createHostAdapter,
    resolveWorkspaceDirectory: resolvers.resolveWorkspaceDirectory,
    loadWorkspaceConfig: resolvers.loadWorkspaceConfig,
    resolveEntrypoint: resolvers.resolveEntrypoint,
    resolveOptionalStatePath: resolvers.resolveOptionalStatePath,
    resolveStateDiscoveryBaseDir: resolvers.resolveStateDiscoveryBaseDir,
    resolveDiscoveredStatePath: resolvers.resolveDiscoveredStatePath,
    readJsonObjectFile: resolvers.readJsonObjectFile,
    toWorkspaceDisplayPath: resolvers.toWorkspaceDisplayPath,
    resolvePathFromBaseDirectory: resolvers.resolvePathFromBaseDirectory,
    existsSync: resolvers.existsSync,
    getDeclaredEffectChannels,
    getRequiredCapabilities,
    getConfiguredModules,
    getDeclaredExternals,
    normalizeEffectsPolicy,
    validateDeclaredEffectBindings,
    validateRequiredCapabilityBindings,
    validateConfigReferences,
    validateNoForbiddenAgentFields,
    areJsonStatesEqual,
    hasMeaningfulNextVExecutionEvents,
    normalizeInputEvent,
    startTimerHandles,
    clearTimerHandles,
    runNextVScriptFromFile,
    listWorkflowDefinitionFiles: (entrypointPath) => listNextVScriptDependencyFilesFromFile(entrypointPath),
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
    ingressRuntime,
    effectRuntime,
    callAgent,
    defaultModel,
    slowAgentWarningMs,
    parallelMaxConcurrency,
  })

  function getLifecycleState() {
    if (runtimeController.isActive()) return 'running'
    return lifecycleState
  }

  async function start(payload = {}) {
    if (runtimeController.isActive()) {
      throw new Error('nextV runtime already active')
    }

    lifecycleState = 'starting'
    lastError = ''
    try {
      const started = await runtimeController.start(payload)
      lifecycleState = 'running'
      return started
    } catch (err) {
      lifecycleState = 'error'
      lastError = String(err?.message ?? err)
      throw err
    }
  }

  function stop() {
    if (!runtimeController.isActive()) {
      throw new Error('nextV runtime not active')
    }

    lifecycleState = 'stopping'
    try {
      const snapshot = runtimeController.stop()
      lifecycleState = 'stopped'
      return snapshot
    } catch (err) {
      lifecycleState = 'error'
      lastError = String(err?.message ?? err)
      throw err
    }
  }

  function enqueue(payload) {
    return runtimeController.enqueue(payload)
  }

  async function dispatchIngress(payload) {
    return await runtimeController.dispatchIngress(payload)
  }

  function submitCandidate() {
    return runtimeController.submitCandidate()
  }

  function reloadConfig() {
    return runtimeController.reloadConfig()
  }

  function promoteCandidate() {
    return runtimeController.promoteCandidate()
  }

  function getDefinitionStatus() {
    return runtimeController.getDefinitionStatus()
  }

  function getDefinitionFiles() {
    return runtimeController.getDefinitionFiles()
  }

  function getGraph(payload = {}) {
    if (!runtimeController.isActive()) {
      throw new Error('nextV runtime not active')
    }

    const requestedWorkspaceDir = String(payload?.workspaceDir ?? '').trim()
    let rawWorkspaceDir = requestedWorkspaceDir || String(runtimeController.getWorkspaceDir() ?? '').trim()
    if (rawWorkspaceDir && isAbsolute(rawWorkspaceDir)) {
      rawWorkspaceDir = relative(resolvers.repoRoot, rawWorkspaceDir).replace(/\\/g, '/') || '.'
    }
    const workspaceDir = resolvers.resolveWorkspaceDirectory(rawWorkspaceDir)
    const workspaceConfig = runtimeController.getWorkspaceConfig?.() ?? resolvers.loadWorkspaceConfig(workspaceDir)
    const requestedEntrypointValue = String(payload?.entrypointPath ?? '').trim()
    const runtimeEntrypointPath = String(runtimeController.getEntrypointPath() ?? '').trim()
    let requestedEntrypointPath = requestedEntrypointValue || runtimeEntrypointPath
    const workspacePrefix = workspaceDir.relativePath === '.' ? '' : `${workspaceDir.relativePath}/`
    if (workspacePrefix && requestedEntrypointPath.startsWith(workspacePrefix)) {
      requestedEntrypointPath = requestedEntrypointPath.slice(workspacePrefix.length)
    }
    const entrypoint = resolvers.resolveEntrypoint(workspaceDir, requestedEntrypointPath, workspaceConfig)

    const source = readFileSync(entrypoint.absolutePath, 'utf8')
    const ast = parseNextVScript(source, {
      baseDir: dirname(entrypoint.absolutePath),
      filePath: entrypoint.absolutePath,
    })
    const graph = extractEventGraph(ast, {
      declaredExternals: getDeclaredExternals(workspaceConfig),
    })
    const workspaceAbsolutePath = workspaceDir.absolutePath

    for (const node of graph.nodes) {
      if (node?.sourcePath && !String(node.sourcePath).startsWith('(')) {
        node.sourcePath = relative(workspaceAbsolutePath, node.sourcePath).replace(/\\/g, '/')
      }
    }
    for (const edge of Array.isArray(graph.controlEdges) ? graph.controlEdges : []) {
      if (edge?.sourcePath && !String(edge.sourcePath).startsWith('(')) {
        edge.sourcePath = relative(workspaceAbsolutePath, edge.sourcePath).replace(/\\/g, '/')
      }
    }

    const { cycles } = detectCycles(graph)
    const timerNodes = Array.isArray(workspaceConfig?.nextv?.timers)
      ? workspaceConfig.nextv.timers.map((timer) => ({
          id: `timer:${timer.event}`,
          kind: 'timer',
          eventType: timer.event,
          interval: Number(timer.interval),
          runOnStart: timer.runOnStart === true,
          sourcePath: '(host:timers)',
        }))
      : []

    return {
      workspaceDir: workspaceDir.relativePath,
      entrypointPath: relative(workspaceAbsolutePath, entrypoint.absolutePath).replace(/\\/g, '/'),
      nodes: graph.nodes,
      edges: graph.edges,
      controlEdges: graph.controlEdges,
      transitions: graph.transitions,
      cycles,
      ignoredDynamicEmits: graph.ignoredDynamicEmits,
      contractWarnings: graph.contractWarnings,
      timerNodes,
      declaredExternals: graph.declaredExternals,
    }
  }

  function sanitizeRequestMessages(rawMessages) {
    if (!Array.isArray(rawMessages)) return []
    return rawMessages
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null
        const role = String(entry.role ?? '').trim()
        const content = String(entry.content ?? '')
        if (!role) return null
        const images = Array.isArray(entry.images)
          ? entry.images.map((value) => String(value ?? '').trim()).filter(Boolean)
          : []
        return {
          role,
          content,
          ...(images.length > 0 ? { imageCount: images.length } : {}),
        }
      })
      .filter(Boolean)
  }

  function buildFinalRequestSummary(request = {}, wirePayload = {}, resolvedModel = '') {
    const finalMessages = sanitizeRequestMessages(request.messages ?? wirePayload.messages)
    const toolNames = Array.isArray(request.toolNames)
      ? request.toolNames.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
    const transport = wirePayload.transport && typeof wirePayload.transport === 'object'
      ? {
          provider: String(wirePayload.transport.provider ?? '').trim() || undefined,
          baseUrl: String(wirePayload.transport.baseUrl ?? '').trim() || undefined,
          host: String(wirePayload.transport.host ?? '').trim() || undefined,
          port: Number.isInteger(Number(wirePayload.transport.port)) ? Number(wirePayload.transport.port) : undefined,
        }
      : null

    const compactTransport = transport
      ? Object.fromEntries(Object.entries(transport).filter(([, value]) => value !== undefined && value !== ''))
      : null

    return {
      model: String(wirePayload.model ?? resolvedModel ?? '').trim(),
      messageCount: finalMessages.length,
      messages: finalMessages,
      ...(toolNames.length > 0 ? { toolNames } : {}),
      ...(compactTransport && Object.keys(compactTransport).length > 0 ? { transport: compactTransport } : {}),
    }
  }

  function detectRetryGuidanceInjected(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false
    const lastUserMessage = [...messages].reverse().find((entry) => String(entry?.role ?? '').trim() === 'user')
    const content = String(lastUserMessage?.content ?? '')
    return /the previous response/i.test(content)
  }

  function buildResolvedCallSummary({
    targetKind = 'agent',
    target = '',
    prompt = '',
    instructions = '',
    validate = 'coerce',
    retryOnViolation = 0,
    returnsContract = null,
    decideContract = null,
    toolsPolicy = null,
    requestMetadata = null,
  } = {}) {
    const request = requestMetadata && typeof requestMetadata === 'object' ? requestMetadata : {}
    const wirePayload = request.wirePayload && typeof request.wirePayload === 'object'
      ? request.wirePayload
      : {}
    const wireTransport = wirePayload.transport && typeof wirePayload.transport === 'object'
      ? wirePayload.transport
      : {}
    const resolvedModel = String(request.resolvedModel ?? request.model ?? wirePayload.model ?? '').trim()
    const resolvedModelAlias = String(request.resolvedModelAlias ?? '').trim()
    const transportName = String(request.transportName ?? '').trim()
    const transportProvider = String(request.transportProvider ?? wireTransport.provider ?? '').trim()
    const toolNames = Array.isArray(request.toolNames)
      ? request.toolNames.map((value) => String(value ?? '').trim()).filter(Boolean)
      : []
    const messageCountRaw = Number(request.messageCount)
    const messageCount = Number.isFinite(messageCountRaw)
      ? Math.max(0, Math.round(messageCountRaw))
      : undefined
    const finalMessages = sanitizeRequestMessages(request.messages ?? wirePayload.messages)
    const attemptRaw = Number(request.attempt)
    const attempt = Number.isFinite(attemptRaw) ? Math.max(1, Math.round(attemptRaw)) : 1
    const retryLimitRaw = Number(request.retryLimit)
    const retryLimit = Number.isFinite(retryLimitRaw)
      ? Math.max(0, Math.round(retryLimitRaw))
      : Math.max(0, Math.min(8, Number(retryOnViolation) || 0))

    return {
      type: targetKind === 'model' ? 'model_call' : 'agent_call',
      targetKind,
      target: String(request.target ?? target ?? '').trim(),
      resolvedModel,
      ...(resolvedModelAlias && resolvedModelAlias !== resolvedModel ? { resolvedModelAlias } : {}),
      ...(transportName ? { transport: transportName } : {}),
      ...(transportProvider ? { transportProvider } : {}),
      instructions: String(request.instructions ?? instructions ?? '').trim(),
      prompt: String(request.prompt ?? prompt ?? ''),
      ...(typeof messageCount === 'number' ? { messageCount } : {}),
      attempt,
      retryLimit,
      retryGuidanceInjected: detectRetryGuidanceInjected(finalMessages),
      finalMessages,
      finalRequest: buildFinalRequestSummary(request, wirePayload, resolvedModel),
      validate: String(request.validate ?? validate ?? 'coerce').trim() || 'coerce',
      retry_on_contract_violation: Number.isInteger(Number(request.retry_on_contract_violation))
        ? Math.max(0, Math.min(8, Number(request.retry_on_contract_violation)))
        : Math.max(0, Math.min(8, Number(retryOnViolation) || 0)),
      ...(returnsContract != null ? { returns: returnsContract } : {}),
      ...(Array.isArray(decideContract) && decideContract.length > 0 ? { decide: decideContract } : {}),
      ...(toolsPolicy && typeof toolsPolicy === 'object' ? { tools: toolsPolicy } : {}),
      ...(toolNames.length > 0 ? { toolNames } : {}),
    }
  }

  function normalizeCallInspectorCallResult(callResult) {
    if (callResult && typeof callResult === 'object' && !Array.isArray(callResult)
      && Object.prototype.hasOwnProperty.call(callResult, 'value')) {
      return callResult
    }
    return {
      value: callResult,
      outputText: typeof callResult === 'string' ? callResult : '',
      metadata: null,
    }
  }

  function toCallInspectorTryFailureEnvelope(err) {
    const code = String(err?.code ?? '').trim().toLowerCase()
    const outputRaw = Object.prototype.hasOwnProperty.call(err ?? {}, 'output')
      ? err?.output
      : (Object.prototype.hasOwnProperty.call(err ?? {}, 'actual') ? err?.actual : undefined)
    const error = {
      type: code || 'operation_failure',
      message: String(err?.message ?? 'Operation failed.'),
    }
    if (outputRaw !== undefined) {
      error.output = outputRaw
    }
    return { ok: false, error }
  }

  function normalizeCallInspectorToolsPolicy(rawTools) {
    if (rawTools == null) return null
    if (!rawTools || typeof rawTools !== 'object' || Array.isArray(rawTools)) {
      throw new Error('tools must be an object when provided')
    }

    const modeRaw = String(rawTools.mode ?? 'disabled').trim().toLowerCase()
    const mode = modeRaw === 'governed' ? 'governed' : 'disabled'
    if (!['disabled', 'governed'].includes(modeRaw)) {
      throw new Error('tools.mode must be either "disabled" or "governed"')
    }

    if (mode === 'disabled') {
      return { mode: 'disabled' }
    }

    const allow = Array.isArray(rawTools.allow)
      ? [...new Set(rawTools.allow.map((value) => String(value ?? '').trim()).filter(Boolean))]
      : []

    const maxRoundsRaw = Number(rawTools.maxRounds)
    const timeoutMsRaw = Number(rawTools.timeoutMs)
    const maxRounds = Number.isInteger(maxRoundsRaw) && maxRoundsRaw >= 0 ? maxRoundsRaw : 8
    const timeoutMs = Number.isInteger(timeoutMsRaw) && timeoutMsRaw >= 0 ? timeoutMsRaw : 0
    const denyOnUnknownTool = rawTools.denyOnUnknownTool === false ? false : true

    return {
      mode: 'governed',
      allow,
      maxRounds,
      timeoutMs,
      denyOnUnknownTool,
    }
  }

  async function callInspectorExecute(payload = {}) {
    const targetKindRaw = String(payload?.targetKind ?? 'agent').trim().toLowerCase()
    const targetKind = targetKindRaw === 'model' ? 'model' : 'agent'
    const modeRaw = String(payload?.mode ?? 'call').trim().toLowerCase()
    const mode = modeRaw === 'try' ? 'try' : 'call'
    const agentName = String(payload?.agent ?? '').trim()
    const modelName = String(payload?.model ?? '').trim()
    const promptInput = extractComposedInput(payload, {
      legacyKey: 'prompt',
      partsKey: 'promptParts',
      fieldName: 'prompt',
    })
    const instructionsInput = extractComposedInput(payload, {
      legacyKey: 'instructions',
      partsKey: 'instructionParts',
      fieldName: 'instructions',
    })
    const prompt = promptInput.value
    const instructions = instructionsInput.value
    const validateModeRaw = String(payload?.validate ?? '').trim().toLowerCase()
    const validateMode = ['strict', 'coerce', 'none'].includes(validateModeRaw) ? validateModeRaw : 'coerce'
    const retryOnViolationRaw = Number(payload?.retry_on_contract_violation)
    const retryOnViolation = Number.isInteger(retryOnViolationRaw)
      ? Math.max(0, Math.min(8, retryOnViolationRaw))
      : 0
    const toolsPolicy = normalizeCallInspectorToolsPolicy(payload?.tools)

    let returnsContract = null
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'returns')) {
      const rawReturns = payload.returns
      if (typeof rawReturns === 'string') {
        const trimmed = rawReturns.trim()
        if (trimmed) {
          try {
            returnsContract = JSON.parse(trimmed)
          } catch {
            throw new Error('returns must be valid JSON when provided as text')
          }
        }
      } else if (rawReturns != null) {
        returnsContract = rawReturns
      }
    }

    let decideContract = null
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'decide')) {
      const rawDecide = payload.decide
      if (Array.isArray(rawDecide)) {
        decideContract = rawDecide.map((value) => String(value ?? '').trim()).filter(Boolean)
      } else if (typeof rawDecide === 'string') {
        decideContract = rawDecide
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      }
      if (Array.isArray(decideContract) && decideContract.length === 0) {
        decideContract = null
      }
    }

    const normalizedMessages = Array.isArray(payload?.messages)
      ? payload.messages
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const role = String(entry.role ?? '').trim()
          const content = String(entry.content ?? '').trim()
          if (!role || !content) return null
          const normalized = { role, content }
          if (Array.isArray(entry.images) && entry.images.length > 0) {
            normalized.images = entry.images.map((value) => String(value ?? '').trim()).filter(Boolean)
          }
          return normalized
        })
        .filter(Boolean)
      : []

    if (targetKind === 'agent' && !agentName) {
      throw new Error('agent target is required when targetKind is "agent"')
    }
    if (targetKind === 'model' && !modelName) {
      throw new Error('model target is required when targetKind is "model"')
    }
    if (!hasMeaningfulComposedParts(promptInput.parts) && normalizedMessages.length === 0) {
      throw new Error('prompt or messages is required')
    }
    if (returnsContract != null && decideContract != null) {
      throw new Error('returns and decide cannot both be set for the same call')
    }

    const runtimeStatus = getStatus()
    const rawWorkspaceDir = String(payload?.workspaceDir ?? runtimeStatus?.workspaceDir ?? '').trim()
    const workspaceDir = resolvers.resolveWorkspaceDirectory(rawWorkspaceDir)
    const workspaceConfig = resolvers.loadWorkspaceConfig(workspaceDir)

    const hostAdapter = createHostAdapter({
      workspaceDir,
      workspaceConfig,
      getWorkspaceConfig: () => workspaceConfig,
      callAgent,
      defaultModel,
      modelResolutionMode: String(process.env.AGENT_MODEL_RESOLUTION ?? 'strict').trim().toLowerCase() || 'strict',
      captureAgentRequestPayload: true,
      resolvePathFromBaseDirectory: resolvers.resolvePathFromBaseDirectory,
      existsSync: resolvers.existsSync,
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

    const startedAt = Date.now()
    let callResult = null
    let tryEnvelope = null
    let tryError = null
    try {
      callResult = await hostAdapter.callAgent({
        agent: targetKind === 'agent' ? agentName : '',
        model: targetKind === 'model' ? modelName : '',
        prompt,
        instructions,
        messages: normalizedMessages,
        returns: returnsContract,
        decide: decideContract,
        tools: toolsPolicy,
        validate: validateMode,
        retry_on_contract_violation: retryOnViolation,
        on_contract_violation: mode === 'try'
          ? null
          : {
            source: 'call-inspector',
            mode: 'report',
          },
        state: {},
        locals: {},
        event: {
          type: 'call_inspector.execute',
          source: 'call-inspector',
          value: renderComposedTextPreview(promptInput.parts),
          payload: {},
        },
      })
    } catch (err) {
      if (mode !== 'try') throw err
      tryError = err
      tryEnvelope = toCallInspectorTryFailureEnvelope(err)
    }

    const normalizedCallResult = normalizeCallInspectorCallResult(callResult)
    if (mode === 'try' && tryEnvelope == null) {
      tryEnvelope = {
        ok: true,
        value: normalizedCallResult?.value ?? null,
      }
    }

    const isViolation = mode === 'call' && callResult && callResult.__nextv_contract_violation__ === true
    const requestMetadata = normalizedCallResult?.metadata?.request ?? tryError?.requestMetadata ?? null
    const outputTextRaw = String(normalizedCallResult?.outputText ?? '').trim()
    const violationActualRaw = String(callResult?.violation?.actual ?? '').trim()
    const tryOutputRaw = String(tryEnvelope?.error?.output ?? '').trim()
    const outputText = outputTextRaw || violationActualRaw || tryOutputRaw
    const hadTryContractViolation = mode === 'try'
      && tryEnvelope?.ok === false
      && String(tryEnvelope?.error?.type ?? '').trim().toLowerCase() === 'agent_return_contract_violation'
    return {
      call: {
        mode,
        targetKind,
        target: targetKind === 'agent' ? agentName : modelName,
        validate: validateMode,
        retry_on_contract_violation: retryOnViolation,
        ...(toolsPolicy && typeof toolsPolicy === 'object' ? { tools: toolsPolicy } : {}),
      },
      resolvedCall: buildResolvedCallSummary({
        targetKind,
        target: targetKind === 'agent' ? agentName : modelName,
        prompt: renderComposedTextPreview(promptInput.parts),
        instructions: renderComposedTextPreview(instructionsInput.parts),
        validate: validateMode,
        retryOnViolation,
        returnsContract,
        decideContract,
        toolsPolicy,
        requestMetadata,
      }),
      result: {
        actual: outputText,
        output: outputText,
        parsed: mode === 'try'
          ? tryEnvelope
          : (isViolation ? null : (normalizedCallResult?.value ?? null)),
        value: mode === 'try'
          ? tryEnvelope
          : (isViolation ? null : (normalizedCallResult?.value ?? null)),
        metadata: normalizedCallResult?.metadata ?? null,
        violation: mode === 'try'
          ? (hadTryContractViolation
            ? {
              type: String(tryEnvelope?.error?.type ?? ''),
              message: String(tryEnvelope?.error?.message ?? ''),
              actual: String(tryEnvelope?.error?.output ?? ''),
            }
            : null)
          : (isViolation ? (callResult?.violation ?? null) : null),
        hadContractViolation: mode === 'try' ? hadTryContractViolation : isViolation,
      },
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }
  }

  function getSnapshot() {
    return runtimeController.getSnapshot()
  }

  function attachSurface(handler) {
    if (typeof handler !== 'function') {
      throw new Error('attachSurface requires a function handler')
    }
    eventBus.subscribe(handler)
    return () => eventBus.unsubscribe(handler)
  }

  function shutdown() {
    if (runtimeController.isActive()) {
      runtimeController.stop()
    }
    lifecycleState = 'stopped'
  }

  function getStatus() {
    return {
      sessionId,
      state: getLifecycleState(),
      active: runtimeController.isActive(),
      subscribers: eventBus.size,
      workspaceDir: runtimeController.getWorkspaceDir(),
      entrypointPath: runtimeController.getEntrypointPath(),
      definitionFiles: runtimeController.getDefinitionFiles(),
      lastError,
    }
  }

  return {
    sessionId,
    eventBus,
    runtimeController,
    start,
    stop,
    enqueue,
    dispatchIngress,
    reloadConfig,
    submitCandidate,
    promoteCandidate,
    getDefinitionStatus,
    getDefinitionFiles,
    getGraph,
    callInspectorExecute,
    getSnapshot,
    attachSurface,
    shutdown,
    getStatus,
    isActive: () => runtimeController.isActive(),
  }
}
