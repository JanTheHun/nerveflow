import { relative, resolve } from 'node:path'

function extractEventImages(event) {
  const payload = event && typeof event === 'object' ? event.payload : null
  const value = event && typeof event === 'object' ? event.value : null
  const imageCarrier = [payload, value].find((candidate) => (
    candidate && typeof candidate === 'object' && !Array.isArray(candidate) && Array.isArray(candidate.images)
  ))
  if (!imageCarrier) return []
  return imageCarrier.images
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function enrichAgentContractError(err, { agentName, line, statement, sourcePath, sourceLine }) {
  if (!err || typeof err !== 'object') return err
  if (err.code !== 'AGENT_RETURN_CONTRACT_VIOLATION') return err

  const normalizedLine = Number(line)
  const normalizedSourceLine = Number(sourceLine)
  const hasSourceLine = Number.isFinite(normalizedSourceLine) && normalizedSourceLine > 0
  if (hasSourceLine) {
    err.sourceLine = normalizedSourceLine
  }

  const normalizedSourcePath = String(sourcePath ?? '').trim()
  if (normalizedSourcePath && !err.sourcePath) {
    err.sourcePath = normalizedSourcePath
  }

  const preferredLine = hasSourceLine ? normalizedSourceLine : normalizedLine
  if (Number.isFinite(preferredLine) && !Number.isFinite(Number(err.line))) {
    err.line = preferredLine
  }
  if (statement && !err.statement) {
    err.statement = statement
  }
  if (!err.agent) {
    err.agent = agentName
  }

  const baseMessage = String(err.message ?? 'Agent return contract violation.')
  const hasAgentName = baseMessage.includes(`agent("${agentName}")`)
  const withAgent = hasAgentName ? baseMessage : `agent("${agentName}"): ${baseMessage}`
  const displayLine = hasSourceLine ? normalizedSourceLine : normalizedLine
  const fileBasename = normalizedSourcePath ? normalizedSourcePath.replace(/\\/g, '/').split('/').pop() : ''
  const locationStr = fileBasename && Number.isFinite(displayLine) && displayLine > 0
    ? `${fileBasename}:${displayLine}`
    : (Number.isFinite(displayLine) && displayLine > 0 ? `line ${displayLine}` : fileBasename)
  const withLine = locationStr && !withAgent.includes(locationStr)
    ? `${withAgent} (${locationStr})`
    : withAgent

  err.message = withLine
  return err
}

function annotateRetryExhaustion(err, retryLimit, attemptNum) {
  if (!err || typeof err !== 'object') return err

  const retriesUsed = Number.isInteger(attemptNum) ? Math.max(0, attemptNum) : 0
  const configuredRetries = Number.isInteger(retryLimit) ? Math.max(0, retryLimit) : 0
  const attempts = retriesUsed + 1

  err.retryCount = retriesUsed
  err.retryLimit = configuredRetries
  err.attempts = attempts

  if (retriesUsed > 0) {
    const baseMessage = String(err.message ?? 'runtime error')
    if (!/after\s+\d+\s+retr(?:y|ies)/i.test(baseMessage)) {
      const label = retriesUsed === 1 ? 'retry' : 'retries'
      err.message = `${baseMessage} (after ${retriesUsed} ${label})`
    }
  }

  return err
}

function cloneEventForViolation(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null

  const payload = {
    type: String(event.type ?? ''),
    value: Object.prototype.hasOwnProperty.call(event, 'value') ? event.value : null,
    payload: Object.prototype.hasOwnProperty.call(event, 'payload') ? event.payload : null,
    source: String(event.source ?? ''),
  }

  try {
    return JSON.parse(JSON.stringify(payload))
  } catch {
    // Best effort only; avoid surfacing serialization errors in violation path.
    return {
      type: payload.type,
      value: null,
      payload: null,
      source: payload.source,
    }
  }
}

function normalizeAgentTransportResult(result) {
  if (typeof result === 'string') {
    return { text: result, metadata: null }
  }

  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const hasText = Object.prototype.hasOwnProperty.call(result, 'text')
      || Object.prototype.hasOwnProperty.call(result, 'content')
      || Object.prototype.hasOwnProperty.call(result, 'response')

    const text = hasText
      ? String(result.text ?? result.content ?? result.response ?? '').trim()
      : String(result.value ?? '').trim()

    const metadata = (result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata))
      ? result.metadata
      : null

    return { text, metadata }
  }

  return {
    text: String(result ?? '').trim(),
    metadata: null,
  }
}

/**
 * Creates a standard nextV host adapter for a given workspace session.
 *
 * @param {object} opts
 * @param {object} opts.workspaceDir       - resolved workspace dir { absolutePath, relativePath }
 * @param {object} opts.workspaceConfig    - loaded workspace config (from workspace_config.js)
 * @param {function} [opts.getWorkspaceConfig] - optional getter for live workspace config
 * @param {function} opts.callAgent        - transport fn: ({ model, messages }) => Promise<string|{text:string,metadata?:object}>
 * @param {string}  [opts.defaultModel]    - fallback model name if agent profile has none
 * @param {function} opts.resolvePathFromBaseDirectory - workspace-safe path resolver
 * @param {function} opts.existsSync       - fs.existsSync
 * @param {function} opts.runNextVScriptFromFile  - runtime script runner
 * @param {function} opts.validateOutputContract  - output contract validator
 * @param {function} opts.appendAgentFormatInstructions - prompt formatter
 * @param {function} opts.normalizeAgentFormattedOutput - output normalizer
 * @param {function} opts.buildAgentRetryPrompt  - retry error formatter
 * @param {object|null} opts.toolRuntime  - optional tool runtime with call(payload)
 */
export function createHostAdapter({
  workspaceDir,
  workspaceConfig,
  getWorkspaceConfig = null,
  callAgent,
  defaultModel = '',
  slowAgentWarningMs = 15000,
  onSlowAgentCallWarning = null,
  resolvePathFromBaseDirectory,
  existsSync,
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
}) {
  const readWorkspaceConfig = () => {
    if (typeof getWorkspaceConfig === 'function') {
      const liveConfig = getWorkspaceConfig()
      if (liveConfig && typeof liveConfig === 'object') return liveConfig
    }
    if (workspaceConfig && typeof workspaceConfig === 'object') return workspaceConfig
    return {}
  }

  function resolveToolName(toolNameRaw) {
    const aliases = readWorkspaceConfig()?.tools?.aliases ?? {}
    const fallbackName = String(toolNameRaw ?? '').trim()
    let current = fallbackName
    const visited = new Set()

    while (current && Object.prototype.hasOwnProperty.call(aliases, current)) {
      if (visited.has(current)) break
      visited.add(current)
      const next = String(aliases[current] ?? '').trim()
      if (!next) break
      current = next
    }

    return current || fallbackName
  }

  function resolveAgentProfile(agentName) {
    const profiles = readWorkspaceConfig()?.agents?.profiles ?? {}
    return profiles[agentName] ?? null
  }

  // Session-scoped cache: avoids redundant multi-layer config lookups per callAgent invocation.
  const resolvedAgentConfigCache = new Map()

  function resolveAgentConfig(agentName) {
    if (resolvedAgentConfigCache.has(agentName)) {
      return resolvedAgentConfigCache.get(agentName)
    }

    const config = readWorkspaceConfig()
    const profiles = config?.agents?.profiles ?? {}
    const modelsMap = config?.models?.map ?? {}
    const transportsMap = config?.transports?.map ?? {}

    const agent = agentName ? profiles[agentName] : null
    if (agentName && !agent) {
      return { error: 'AGENT_NOT_FOUND', agent: agentName }
    }

    if (!agentName) {
      return { agent: null, model: null, transport: null }
    }

    const modelRef = String(agent?.model ?? '').trim()
    if (!modelRef) {
      return { error: 'AGENT_MISSING_MODEL_REF', agent: agentName }
    }

    const modelConfig = modelsMap[modelRef]
    if (modelConfig) {
      // Full registry path: agents.profiles → models.map → transports.map
      const transportLabel = String(modelConfig?.transport ?? '').trim()
      const transportConfig = transportsMap[transportLabel] ?? null
      const result = {
        agent: {
          name: agentName,
          instructions: String(agent?.instructions ?? '').trim(),
          tools: Array.isArray(agent?.tools) ? [...agent.tools] : [],
        },
        model: {
          name: modelRef,
          id: String(modelConfig?.model ?? '').trim(),
          transport: transportLabel,
        },
        transportConfig,
        source: 'config',
      }
      resolvedAgentConfigCache.set(agentName, result)
      return result
    }

    // Backward-compat path: modelRef is treated as a direct model name (no registry entry).
    // transportConfig is null since no transport label is known.
    const result = {
      agent: {
        name: agentName,
        instructions: String(agent?.instructions ?? '').trim(),
        tools: Array.isArray(agent?.tools) ? [...agent.tools] : [],
      },
      model: {
        name: modelRef,
        id: modelRef,
        transport: '',
      },
      transportConfig: null,
      source: 'config',
    }
    resolvedAgentConfigCache.set(agentName, result)
    return result
  }

  const adapter = {
    clearConfigCache: () => {
      resolvedAgentConfigCache.clear()
    },

    getAgentCapabilities: () => {
      // Prefer runtime-detected capabilities (e.g. set directly on callAgent function by host).
      if (callAgent && typeof callAgent === 'function' && callAgent.capabilities && typeof callAgent.capabilities === 'object') {
        return callAgent.capabilities
      }
      // Fall back to config-declared transport metadata when no runtime detection is present.
      const transportsMap = readWorkspaceConfig()?.transports?.map ?? {}
      if (Object.keys(transportsMap).length > 0) {
        return { source: 'config', transports: transportsMap }
      }
      return null
    },

    callTool: async ({ name, args, positional, state, event, locals, line, statement }) => {
      const toolNameRaw = String(name ?? '').trim()
      const toolName = resolveToolName(toolNameRaw)
      const allowedTools = readWorkspaceConfig()?.tools?.allow ?? null
      if (allowedTools && !allowedTools.has(toolName)) {
        throw new Error(`Tool "${toolNameRaw}" is not allowed by workspace tools policy.`)
      }
      if (toolRuntime && typeof toolRuntime.call === 'function') {
        return await toolRuntime.call({
          name: toolName,
          requestedName: toolNameRaw,
          args,
          positional,
          state,
          event,
          locals,
          line,
          statement,
        })
      }
      throw new Error(`Tool "${toolName}" is not available in this host yet.`)
    },

    callAgent: async ({ agent, model: modelRaw, prompt, instructions, messages, format, returns, validate, decide, retry_on_contract_violation, on_contract_violation, event, line, statement, sourcePath, sourceLine }) => {
      const agentName = String(agent ?? '').trim()
      const directModel = String(modelRaw ?? '').trim()

      let resolvedModel = directModel || defaultModel || ''
      let profileInstructions = ''
      let profileTools = []
      let resolvedTransportConfig = null
      let configSource = 'env'

      if (agentName) {
        const resolved = resolveAgentConfig(agentName)
        if (resolved.error) {
          if (resolved.error === 'AGENT_NOT_FOUND') {
            throw new Error(`agent("${agentName}") profile was not found in workspace config.`)
          }
          if (resolved.error === 'AGENT_MISSING_MODEL_REF') {
            throw new Error(`agent("${agentName}") is missing model; set it in agents.json or defaultModel env.`)
          }
          throw new Error(`agent("${agentName}") could not be resolved: ${resolved.error}`)
        }

        if (resolved.source === 'config') {
          resolvedModel = resolved.model.id
          profileInstructions = resolved.agent.instructions
          profileTools = resolved.agent.tools
          resolvedTransportConfig = resolved.transportConfig
          configSource = 'config'
        }
      }

      if (!resolvedModel) {
        if (agentName) {
          throw new Error(`agent("${agentName}") is missing model; set it in agents.json or OLLAMA_MODEL.`)
        }
        throw new Error('model() is missing model name.')
      }

      const callLabel = agentName ? `agent("${agentName}")` : `model("${resolvedModel}")`
      const callInstructions = String(instructions ?? '').trim()
      const baseInstructions = [profileInstructions, callInstructions].filter(Boolean).join('\n\n')
      const contractGuidance = (returns != null && typeof buildAgentReturnContractGuidance === 'function')
        ? buildAgentReturnContractGuidance(returns)
        : (decide != null && typeof buildDecideGuidance === 'function')
          ? buildDecideGuidance(decide)
          : ''
      const baseSystemInstructions = [baseInstructions, contractGuidance].filter(Boolean).join('\n\n')

      const formattedPrompt = format ? appendAgentFormatInstructions(prompt, format) : String(prompt ?? '')
      const inputMessages = Array.isArray(messages) ? messages : []

      const retryLimit = Number.isInteger(retry_on_contract_violation) ? Math.max(0, retry_on_contract_violation) : 0
      let lastViolation = null
      let previousViolationKey = null

      for (let attemptNum = 0; attemptNum <= retryLimit; attemptNum += 1) {
        const chatMessages = []
        if (baseSystemInstructions) {
          chatMessages.push({ role: 'system', content: baseSystemInstructions })
        }
        for (const entry of inputMessages) {
          const role = String(entry?.role ?? '').trim()
          const content = String(entry?.content ?? '').trim()
          if (!role || !content) continue
          const msgEntry = { role, content }
          if (Array.isArray(entry.images) && entry.images.length > 0) {
            msgEntry.images = entry.images
          }
          chatMessages.push(msgEntry)
        }

        let userPrompt = formattedPrompt.trim()
        if (attemptNum > 0 && lastViolation != null) {
          if (decide != null && typeof buildDecideRetryPrompt === 'function') {
            const retryGuidance = buildDecideRetryPrompt(decide, lastViolation)
            userPrompt = [userPrompt, retryGuidance].filter(Boolean).join('\n\n')
          } else if (typeof buildAgentRetryPrompt === 'function') {
            const retryGuidance = buildAgentRetryPrompt(lastViolation)
            userPrompt = [userPrompt, retryGuidance].filter(Boolean).join('\n\n')
          }
        }

        if (userPrompt) {
          const eventImages = extractEventImages(event)
          if (eventImages.length > 0) {
            chatMessages.push({ role: 'user', content: userPrompt, images: eventImages })
          } else {
            chatMessages.push({ role: 'user', content: userPrompt })
          }
        }

        if (chatMessages.length === 0) {
          throw new Error(`${callLabel} has no prompt/messages to send.`)
        }

        const callStartedAt = Date.now()
        let slowWarningEmitted = false
        let slowWarningTimer = null

        if (
          Number.isFinite(Number(slowAgentWarningMs))
          && Number(slowAgentWarningMs) > 0
          && typeof onSlowAgentCallWarning === 'function'
        ) {
          slowWarningTimer = setTimeout(() => {
            slowWarningEmitted = true
            try {
              onSlowAgentCallWarning({
                agent: agentName || `model:${resolvedModel}`,
                model: resolvedModel,
                attempt: attemptNum + 1,
                retryLimit,
                elapsedMs: Number(slowAgentWarningMs),
                thresholdMs: Number(slowAgentWarningMs),
                line,
                statement,
                sourcePath,
                sourceLine,
                eventType: String(event?.type ?? ''),
                eventSource: String(event?.source ?? ''),
                workspaceDir: String(workspaceDir?.relativePath ?? ''),
              })
            } catch {
              // Best-effort only; warning emission must not affect agent execution.
            }
          }, Number(slowAgentWarningMs))
          if (typeof slowWarningTimer?.unref === 'function') {
            slowWarningTimer.unref()
          }
        }

        let transportResult
        try {
          const callPayload = { model: resolvedModel, messages: chatMessages }
          if (resolvedTransportConfig !== null) {
            callPayload.transport = resolvedTransportConfig
          }
          transportResult = await callAgent(callPayload)
        } finally {
          if (slowWarningTimer) {
            clearTimeout(slowWarningTimer)
          }
        }

        const elapsedMs = Math.max(0, Date.now() - callStartedAt)
        const { text: raw, metadata } = normalizeAgentTransportResult(transportResult)
        const metadataWithTiming = (
          metadata && typeof metadata === 'object'
            ? { ...metadata, elapsedMs, slowWarningEmitted }
            : (slowWarningEmitted ? { elapsedMs, slowWarningEmitted } : null)
        )
        if (returns != null) {
          if (validate === 'none') {
            let lateBindValue
            try {
              lateBindValue = normalizeAgentFormattedOutput(raw, 'json')
            } catch {
              lateBindValue = raw
            }
            return { value: lateBindValue, metadata: metadataWithTiming }
          }

          let parsed
          try {
            parsed = normalizeAgentFormattedOutput(raw, 'json')
          } catch (parseErr) {
            lastViolation = parseErr
            const violationKey = `JSON_PARSE_ERROR:${String(parseErr?.message ?? '').slice(0, 80)}`
            previousViolationKey = violationKey
            if (attemptNum < retryLimit) {
              continue
            }
            if (on_contract_violation != null) {
              return {
                __nextv_contract_violation__: true,
                expression: on_contract_violation,
                violation: {
                  type: 'json_parse_error',
                  field: '',
                  expected: 'valid JSON',
                  actual: String(parseErr?.message ?? 'Failed to parse JSON output'),
                  source_event: cloneEventForViolation(event),
                },
              }
            }
            annotateRetryExhaustion(parseErr, retryLimit, attemptNum)
            throw parseErr
          }
          if (typeof validateAgentReturnContract === 'function') {
            const mode = String(validate ?? '').trim() || 'coerce'
            try {
              return {
                value: validateAgentReturnContract(parsed, returns, mode),
                metadata: metadataWithTiming,
              }
            } catch (err) {
              lastViolation = err
              const violationKey = `${err?.path}:${err?.expected}:${err?.actual}`
              if (violationKey === previousViolationKey && attemptNum < retryLimit) {
                previousViolationKey = violationKey
                continue
              }
              previousViolationKey = violationKey
              if (attemptNum < retryLimit) {
                continue
              }
              if (on_contract_violation != null) {
                return {
                  __nextv_contract_violation__: true,
                  expression: on_contract_violation,
                  violation: {
                    type: 'contract_violation',
                    message: String(err?.message ?? ''),
                    field: String(err?.path ?? ''),
                    expected: String(err?.expected ?? ''),
                    actual: String(err?.actual ?? ''),
                    source_event: cloneEventForViolation(event),
                  },
                }
              }
              enrichAgentContractError(err, { agentName, line, statement, sourcePath, sourceLine })
              annotateRetryExhaustion(err, retryLimit, attemptNum)
              throw err
            }
          }
          return { value: parsed, metadata: metadataWithTiming }
        }

        // decide contract: plain-text enum validation, no JSON parsing
        if (decide != null && typeof validateDecideOutput === 'function') {
          try {
            const matched = validateDecideOutput(raw, decide)
            return { value: matched, metadata: metadataWithTiming }
          } catch (err) {
            lastViolation = String(raw ?? '')
            const violationKey = `DECIDE_MISMATCH:${String(raw ?? '').slice(0, 80)}`
            if (violationKey === previousViolationKey && attemptNum < retryLimit) {
              previousViolationKey = violationKey
              continue
            }
            previousViolationKey = violationKey
            if (attemptNum < retryLimit) continue
            if (on_contract_violation != null) {
              return {
                __nextv_contract_violation__: true,
                expression: on_contract_violation,
                violation: {
                  type: 'contract_violation',
                  subtype: 'decide_mismatch',
                  message: String(err?.message ?? ''),
                  field: '',
                  expected: Array.isArray(decide) ? decide.join(', ') : String(decide),
                  actual: String(raw ?? ''),
                  source_event: cloneEventForViolation(event),
                },
              }
            }
            const decideErr = new Error(`decide contract violation: output "${String(raw ?? '').slice(0, 80)}" does not match any allowed value.`)
            decideErr.code = 'AGENT_RETURN_CONTRACT_VIOLATION'
            annotateRetryExhaustion(decideErr, retryLimit, attemptNum)
            throw decideErr
          }
        }

        if (!format) return { value: raw, metadata: metadataWithTiming }
        return {
          value: normalizeAgentFormattedOutput(raw, format),
          metadata: metadataWithTiming,
        }
      }
    },

    callScript: async ({ path, state: runtimeState, event, locals, executionRole, onEvent }) => {
      const resolved = resolvePathFromBaseDirectory(workspaceDir.absolutePath, String(path ?? '').trim(), 'script')
      if (!existsSync(resolved.absolutePath)) {
        throw new Error(`Script file not found: ${resolved.relativePath}`)
      }

      const result = await runNextVScriptFromFile(resolved.absolutePath, {
        state: runtimeState,
        event,
        locals,
        executionRole,
        emitStateUpdates: false,
        onEvent,
        hostAdapter: {
          callAgent: async (payload) => adapter.callAgent(payload),
          callTool: async (payload) => adapter.callTool(payload),
        },
      })

      if (result?.returnValue !== undefined) {
        validateOutputContract(result.returnValue)
      }

      return result
    },

    resolveOperatorPath: async (operatorIdRaw) => {
      const operatorId = String(operatorIdRaw ?? '').trim()
      if (!operatorId) {
        throw new Error('operator() requires a non-empty operator id.')
      }

      const configuredPath = String(readWorkspaceConfig()?.operators?.map?.[operatorId]?.entrypointPath ?? '').trim()
      let selectedPath = configuredPath
      if (!selectedPath) {
        const nrvFallbackPath = `operators/${operatorId}/main.nrv`
        const wfsFallbackPath = `operators/${operatorId}/main.wfs`
        const nrvAbsolutePath = resolve(workspaceDir.absolutePath, nrvFallbackPath)
        const wfsAbsolutePath = resolve(workspaceDir.absolutePath, wfsFallbackPath)
        selectedPath = existsSync(nrvAbsolutePath)
          ? nrvFallbackPath
          : (existsSync(wfsAbsolutePath) ? wfsFallbackPath : nrvFallbackPath)
      }

      const resolved = resolvePathFromBaseDirectory(workspaceDir.absolutePath, selectedPath, 'script')
      return relative(workspaceDir.absolutePath, resolved.absolutePath).replace(/\\/g, '/')
    },
  }

  return adapter
}
