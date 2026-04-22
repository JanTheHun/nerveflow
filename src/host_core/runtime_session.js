import { relative, resolve } from 'node:path'

/**
 * Creates a standard nextV host adapter for a given workspace session.
 *
 * @param {object} opts
 * @param {object} opts.workspaceDir       - resolved workspace dir { absolutePath, relativePath }
 * @param {object} opts.workspaceConfig    - loaded workspace config (from workspace_config.js)
 * @param {function} opts.callAgent        - transport fn: ({ model, messages }) => Promise<string>
 * @param {string}  [opts.defaultModel]    - fallback model name if agent profile has none
 * @param {function} opts.resolvePathFromBaseDirectory - workspace-safe path resolver
 * @param {function} opts.existsSync       - fs.existsSync
 * @param {function} opts.runNextVScriptFromFile  - runtime script runner
 * @param {function} opts.validateOutputContract  - output contract validator
 * @param {function} opts.appendAgentFormatInstructions - prompt formatter
 * @param {function} opts.normalizeAgentFormattedOutput - output normalizer
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
    callTool: async ({ name }) => {
      const toolNameRaw = String(name ?? '').trim()
      const toolName = resolveToolName(toolNameRaw)
      const allowedTools = workspaceConfig?.tools?.allow ?? null
      if (allowedTools && !allowedTools.has(toolName)) {
        throw new Error(`Tool "${toolNameRaw}" is not allowed by workspace tools policy.`)
      }
      throw new Error(`Tool "${toolName}" is not available in this host yet.`)
    },

    callAgent: async ({ agent, prompt, instructions, messages, format }) => {
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
      const systemInstructions = [profileInstructions, callInstructions].filter(Boolean).join('\n\n')

      const formattedPrompt = format ? appendAgentFormatInstructions(prompt, format) : String(prompt ?? '')
      const inputMessages = Array.isArray(messages) ? messages : []

      const chatMessages = []
      if (systemInstructions) {
        chatMessages.push({ role: 'system', content: systemInstructions })
      }
      for (const entry of inputMessages) {
        const role = String(entry?.role ?? '').trim()
        const content = String(entry?.content ?? '').trim()
        if (!role || !content) continue
        chatMessages.push({ role, content })
      }
      if (formattedPrompt.trim()) {
        chatMessages.push({ role: 'user', content: formattedPrompt.trim() })
      }

      if (chatMessages.length === 0) {
        throw new Error(`agent("${agentName}") has no prompt/messages to send.`)
      }

      const raw = await callAgent({ model, messages: chatMessages })
      if (!format) return raw
      return normalizeAgentFormattedOutput(raw, format)
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
