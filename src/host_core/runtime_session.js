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
  const withLine = Number.isFinite(displayLine) && !withAgent.includes(`line ${displayLine}`)
    ? `${withAgent} (line ${displayLine})`
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
  callAgent,
  defaultModel = '',
  resolvePathFromBaseDirectory,
  existsSync,
  runNextVScriptFromFile,
  validateOutputContract,
  appendAgentFormatInstructions,
  normalizeAgentFormattedOutput,
  validateAgentReturnContract = null,
  buildAgentReturnContractGuidance = null,
  buildAgentRetryPrompt = null,
  toolRuntime = null,
}) {
  function resolveToolName(toolNameRaw) {
    const aliases = workspaceConfig?.tools?.aliases ?? {}
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
    const profiles = workspaceConfig?.agents?.profiles ?? {}
    return profiles[agentName] ?? null
  }

  const adapter = {
    callTool: async ({ name, args, positional, state, event, locals, line, statement }) => {
      const toolNameRaw = String(name ?? '').trim()
      const toolName = resolveToolName(toolNameRaw)
      const allowedTools = workspaceConfig?.tools?.allow ?? null
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

    callAgent: async ({ agent, prompt, instructions, messages, format, returns, validate, retry_on_contract_violation, on_contract_violation, event, line, statement, sourcePath, sourceLine }) => {
      const agentName = String(agent ?? '').trim()
      const profile = resolveAgentProfile(agentName)
      if (!profile) {
        throw new Error(`agent("${agentName}") profile was not found in workspace config.`)
      }

      const model = String(profile.model ?? defaultModel ?? '').trim()
      if (!model) {
        throw new Error(`agent("${agentName}") is missing model; set it in agents.json or OLLAMA_MODEL.`)
      }

      const profileInstructions = String(profile.instructions ?? '').trim()
      const callInstructions = String(instructions ?? '').trim()
      const baseInstructions = [profileInstructions, callInstructions].filter(Boolean).join('\n\n')
      const contractGuidance = (returns != null && typeof buildAgentReturnContractGuidance === 'function')
        ? buildAgentReturnContractGuidance(returns)
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
        if (attemptNum > 0 && lastViolation != null && typeof buildAgentRetryPrompt === 'function') {
          const retryGuidance = buildAgentRetryPrompt(lastViolation)
          userPrompt = [userPrompt, retryGuidance].filter(Boolean).join('\n\n')
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
          throw new Error(`agent("${agentName}") has no prompt/messages to send.`)
        }

        const transportResult = await callAgent({ model, messages: chatMessages })
        const { text: raw, metadata } = normalizeAgentTransportResult(transportResult)
        if (returns != null) {
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
                metadata,
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
          return { value: parsed, metadata }
        }
        if (!format) return { value: raw, metadata }
        return {
          value: normalizeAgentFormattedOutput(raw, format),
          metadata,
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

      const configuredPath = String(workspaceConfig.operators.map?.[operatorId]?.entrypointPath ?? '').trim()
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
