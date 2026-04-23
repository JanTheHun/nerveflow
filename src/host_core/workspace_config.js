import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILTIN_OUTPUT_CHANNELS = new Set(['text', 'console', 'voice', 'visual', 'json', 'interaction'])

function parseProfilesMap(raw, sourceLabel) {
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.profiles && typeof raw.profiles === 'object' && !Array.isArray(raw.profiles))
    ? raw.profiles
    : raw

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${sourceLabel} must be an object map of profileName -> profileConfig.`)
  }

  for (const [name, profile] of Object.entries(map)) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new Error(`${sourceLabel}: profile "${name}" must be an object.`)
    }
    if (profile.model != null && typeof profile.model !== 'string') {
      throw new Error(`${sourceLabel}: profile "${name}.model" must be a string.`)
    }
    if (profile.instructions != null && typeof profile.instructions !== 'string') {
      throw new Error(`${sourceLabel}: profile "${name}.instructions" must be a string.`)
    }
    if (profile.tools != null) {
      if (!Array.isArray(profile.tools) || profile.tools.some((tool) => typeof tool !== 'string')) {
        throw new Error(`${sourceLabel}: profile "${name}.tools" must be an array of strings.`)
      }
    }
  }

  return map
}

function parseWorkspaceToolsConfig(raw, sourceLabel) {
  let allow
  let aliases = {}

  const validateAliases = (aliasesMap) => {
    const aliasKeys = Object.keys(aliasesMap)
    for (const alias of aliasKeys) {
      const aliasName = String(alias).trim()
      if (!aliasName) {
        throw new Error(`${sourceLabel}: alias names must be non-empty strings.`)
      }
      const targetName = String(aliasesMap[alias] ?? '').trim()
      if (!targetName) {
        throw new Error(`${sourceLabel}: alias "${alias}" target must be a non-empty string.`)
      }
    }

    const hasAlias = (name) => Object.prototype.hasOwnProperty.call(aliasesMap, name)
    for (const startAlias of aliasKeys) {
      const visited = new Set()
      let current = startAlias
      while (hasAlias(current)) {
        if (visited.has(current)) {
          throw new Error(`${sourceLabel}: aliases contain a cycle involving "${current}".`)
        }
        visited.add(current)
        current = String(aliasesMap[current] ?? '').trim()
      }
    }
  }

  if (Array.isArray(raw)) {
    allow = raw
  } else if (raw && typeof raw === 'object') {
    const allowRaw = raw.allow ?? raw.tools ?? null
    if (allowRaw != null) {
      if (!Array.isArray(allowRaw) || allowRaw.some((name) => typeof name !== 'string')) {
        throw new Error(`${sourceLabel}: allow/tools must be an array of strings.`)
      }
      allow = allowRaw
    }

    if (raw.aliases != null) {
      if (!raw.aliases || typeof raw.aliases !== 'object' || Array.isArray(raw.aliases)) {
        throw new Error(`${sourceLabel}: aliases must be an object map of alias -> tool name.`)
      }
      for (const [alias, target] of Object.entries(raw.aliases)) {
        if (typeof target !== 'string') {
          throw new Error(`${sourceLabel}: alias "${alias}" target must be a string.`)
        }
      }
      aliases = { ...raw.aliases }
      validateAliases(aliases)
    }
  } else {
    throw new Error(`${sourceLabel} must be an object or array.`)
  }

  return {
    allow: Array.isArray(allow) ? new Set(allow) : null,
    aliases,
  }
}

function parseOperatorsMap(raw, sourceLabel) {
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.operators && typeof raw.operators === 'object' && !Array.isArray(raw.operators))
    ? raw.operators
    : raw

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${sourceLabel} must be an object map of operatorId -> operatorConfig.`)
  }

  for (const [name, operator] of Object.entries(map)) {
    if (!operator || typeof operator !== 'object' || Array.isArray(operator)) {
      throw new Error(`${sourceLabel}: operator "${name}" must be an object.`)
    }
    if (typeof operator.entrypointPath !== 'string' || !operator.entrypointPath.trim()) {
      throw new Error(`${sourceLabel}: operator "${name}.entrypointPath" must be a non-empty string.`)
    }
    if (operator.baselineStatePath != null && typeof operator.baselineStatePath !== 'string') {
      throw new Error(`${sourceLabel}: operator "${name}.baselineStatePath" must be a string.`)
    }
    if (operator.runtimeStatePath != null && typeof operator.runtimeStatePath !== 'string') {
      throw new Error(`${sourceLabel}: operator "${name}.runtimeStatePath" must be a string.`)
    }
  }

  return map
}

function parseEffectsMap(raw, sourceLabel) {
  if (Array.isArray(raw)) {
    const map = {}
    for (const channelNameRaw of raw) {
      const channelName = String(channelNameRaw ?? '').trim()
      if (!channelName) {
        throw new Error(`${sourceLabel}: effect channel names must be non-empty strings.`)
      }
      map[channelName] = {}
    }
    return map
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must be an array of strings or an object map of channel -> config.`)
  }

  const map = {}
  for (const [channelNameRaw, channelConfigRaw] of Object.entries(raw)) {
    const channelName = String(channelNameRaw ?? '').trim()
    if (!channelName) {
      throw new Error(`${sourceLabel}: effect channel names must be non-empty strings.`)
    }
    if (!channelConfigRaw || typeof channelConfigRaw !== 'object' || Array.isArray(channelConfigRaw)) {
      throw new Error(`${sourceLabel}: effect channel "${channelName}" config must be an object.`)
    }

    const channelConfig = { ...channelConfigRaw }
    if (channelConfig.kind != null && typeof channelConfig.kind !== 'string') {
      throw new Error(`${sourceLabel}: effect channel "${channelName}.kind" must be a string when provided.`)
    }
    if (channelConfig.format != null) {
      if (typeof channelConfig.format !== 'string') {
        throw new Error(`${sourceLabel}: effect channel "${channelName}.format" must be a string when provided.`)
      }
      const normalizedFormat = channelConfig.format.trim()
      if (!normalizedFormat || !BUILTIN_OUTPUT_CHANNELS.has(normalizedFormat)) {
        throw new Error(
          `${sourceLabel}: effect channel "${channelName}.format" must be one of ${[...BUILTIN_OUTPUT_CHANNELS].join(', ')}.`,
        )
      }
      channelConfig.format = normalizedFormat
    }

    map[channelName] = channelConfig
  }

  return map
}

function parseEffectsPolicy(raw, sourceLabel) {
  if (raw == null) return undefined
  if (typeof raw !== 'string') {
    throw new Error(`${sourceLabel} must be either "warn" or "strict" when provided.`)
  }

  const normalizedPolicy = raw.trim().toLowerCase()
  if (!normalizedPolicy || (normalizedPolicy !== 'warn' && normalizedPolicy !== 'strict')) {
    throw new Error(`${sourceLabel} must be either "warn" or "strict" when provided.`)
  }
  return normalizedPolicy
}

export function loadWorkspaceNextVConfig({
  workspaceDir,
  toWorkspaceDisplayPath,
  resolvePathFromBaseDirectory,
  readJsonObjectFile,
}) {
  const nextVPath = join(workspaceDir.absolutePath, 'nextv.json')
  const agentsPath = join(workspaceDir.absolutePath, 'agents.json')
  const toolsPath = join(workspaceDir.absolutePath, 'tools.json')
  const operatorsPath = join(workspaceDir.absolutePath, 'operators.json')
  const nextVDisplayPath = toWorkspaceDisplayPath(nextVPath)

  const config = {
    agents: {
      status: 'missing',
      file: toWorkspaceDisplayPath(agentsPath),
      source: toWorkspaceDisplayPath(agentsPath),
      profiles: {},
    },
    tools: {
      status: 'missing',
      file: toWorkspaceDisplayPath(toolsPath),
      source: toWorkspaceDisplayPath(toolsPath),
      allow: null,
      aliases: {},
    },
    nextv: { status: 'missing', file: nextVDisplayPath, config: {}, timers: [], timersSource: '' },
    operators: {
      status: 'missing',
      file: toWorkspaceDisplayPath(operatorsPath),
      source: toWorkspaceDisplayPath(operatorsPath),
      map: {},
    },
    effects: {
      status: 'missing',
      file: `${nextVDisplayPath}#effects`,
      source: `${nextVDisplayPath}#effects`,
      map: {},
    },
  }

  if (existsSync(nextVPath)) {
    config.nextv.config = readJsonObjectFile(nextVPath)
    config.nextv.status = 'loaded'

    if (Object.prototype.hasOwnProperty.call(config.nextv.config, 'effectsPolicy')) {
      config.nextv.config.effectsPolicy = parseEffectsPolicy(config.nextv.config.effectsPolicy, 'nextv.json#effectsPolicy')
    }

    if (config.nextv.config.agents != null) {
      config.agents.profiles = parseProfilesMap(config.nextv.config.agents, 'nextv.json#agents')
      config.agents.status = 'loaded'
      config.agents.source = `${nextVDisplayPath}#agents`
    }

    if (config.nextv.config.tools != null) {
      const parsed = parseWorkspaceToolsConfig(config.nextv.config.tools, 'nextv.json#tools')
      config.tools.allow = parsed.allow
      config.tools.aliases = parsed.aliases
      config.tools.status = 'loaded'
      config.tools.source = `${nextVDisplayPath}#tools`
    }

    if (config.nextv.config.operators != null) {
      config.operators.map = parseOperatorsMap(config.nextv.config.operators, 'nextv.json#operators')
      config.operators.status = 'loaded'
      config.operators.source = `${nextVDisplayPath}#operators`
    }

    if (config.nextv.config.effects != null) {
      config.effects.map = parseEffectsMap(config.nextv.config.effects, 'nextv.json#effects')
      config.effects.status = 'loaded'
      config.effects.source = `${nextVDisplayPath}#effects`
    }

    const rawTimers = config.nextv.config.timers
    if (Array.isArray(rawTimers)) {
      config.nextv.timers = rawTimers
        .map((timer) => {
          const event = String(timer?.event ?? '').trim()
          const interval = Number(timer?.interval)
          if (!event || !Number.isFinite(interval) || interval <= 0) return null
          return {
            event,
            interval: Math.floor(interval),
            payload: timer?.payload ?? null,
            runOnStart: timer?.runOnStart === true,
          }
        })
        .filter(Boolean)
      config.nextv.timersSource = `${nextVDisplayPath}#timers`
    }

    const agentsConfigRef = String(config.nextv.config.agentsConfig ?? '').trim()
    const toolsConfigRef = String(config.nextv.config.toolsConfig ?? '').trim()
    const operatorsConfigRef = String(config.nextv.config.operatorsConfig ?? '').trim()

    if (agentsConfigRef) {
      const resolvedAgents = resolvePathFromBaseDirectory(workspaceDir.absolutePath, agentsConfigRef, 'editor')
      if (!existsSync(resolvedAgents.absolutePath)) {
        throw new Error(`nextv.json#agentsConfig file not found: ${resolvedAgents.relativePath}`)
      }
      const agentsRaw = readJsonObjectFile(resolvedAgents.absolutePath)
      config.agents.profiles = parseProfilesMap(agentsRaw, 'nextv.json#agentsConfig')
      config.agents.status = 'loaded'
      config.agents.source = toWorkspaceDisplayPath(resolvedAgents.absolutePath)
    }

    if (toolsConfigRef) {
      const resolvedTools = resolvePathFromBaseDirectory(workspaceDir.absolutePath, toolsConfigRef, 'editor')
      if (!existsSync(resolvedTools.absolutePath)) {
        throw new Error(`nextv.json#toolsConfig file not found: ${resolvedTools.relativePath}`)
      }
      const toolsRaw = JSON.parse(readFileSync(resolvedTools.absolutePath, 'utf8'))
      const parsed = parseWorkspaceToolsConfig(toolsRaw, 'nextv.json#toolsConfig')
      config.tools.allow = parsed.allow
      config.tools.aliases = parsed.aliases
      config.tools.status = 'loaded'
      config.tools.source = toWorkspaceDisplayPath(resolvedTools.absolutePath)
    }

    if (operatorsConfigRef) {
      const resolvedOperators = resolvePathFromBaseDirectory(workspaceDir.absolutePath, operatorsConfigRef, 'editor')
      if (!existsSync(resolvedOperators.absolutePath)) {
        throw new Error(`nextv.json#operatorsConfig file not found: ${resolvedOperators.relativePath}`)
      }
      const operatorsRaw = readJsonObjectFile(resolvedOperators.absolutePath)
      config.operators.map = parseOperatorsMap(operatorsRaw, 'nextv.json#operatorsConfig')
      config.operators.status = 'loaded'
      config.operators.source = toWorkspaceDisplayPath(resolvedOperators.absolutePath)
    }
  }

  if (config.agents.status !== 'loaded' && existsSync(agentsPath)) {
    const raw = readJsonObjectFile(agentsPath)
    config.agents.profiles = parseProfilesMap(raw, 'agents.json')
    config.agents.status = 'loaded'
    config.agents.source = toWorkspaceDisplayPath(agentsPath)
  }

  if (config.tools.status !== 'loaded' && existsSync(toolsPath)) {
    const raw = JSON.parse(readFileSync(toolsPath, 'utf8'))
    const parsed = parseWorkspaceToolsConfig(raw, 'tools.json')
    config.tools.allow = parsed.allow
    config.tools.aliases = parsed.aliases
    config.tools.status = 'loaded'
    config.tools.source = toWorkspaceDisplayPath(toolsPath)
  }

  if (config.operators.status !== 'loaded' && existsSync(operatorsPath)) {
    const raw = readJsonObjectFile(operatorsPath)
    config.operators.map = parseOperatorsMap(raw, 'operators.json')
    config.operators.status = 'loaded'
    config.operators.source = toWorkspaceDisplayPath(operatorsPath)
  }

  return config
}

export function getDeclaredExternals(workspaceConfig) {
  const declared = Array.isArray(workspaceConfig?.nextv?.config?.externals)
    ? workspaceConfig.nextv.config.externals
    : []
  const timerEvents = Array.isArray(workspaceConfig?.nextv?.timers)
    ? workspaceConfig.nextv.timers.map((timer) => String(timer?.event ?? '').trim()).filter(Boolean)
    : []
  return [...new Set([...declared, ...timerEvents])]
}

export function getDeclaredEffectChannels(workspaceConfig) {
  const declared = workspaceConfig?.effects?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}
