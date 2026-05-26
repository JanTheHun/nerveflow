import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILTIN_OUTPUT_CHANNELS = new Set(['text', 'console', 'voice', 'visual', 'json', 'interaction'])

function expandEnvPlaceholdersInString(raw, sourceLabel, valuePath, options = {}) {
  const { allowMissingEnv } = options
  const text = String(raw ?? '')
  return text.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/gi, (_match, name) => {
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      return String(process.env[name] ?? '')
    }
    if (typeof allowMissingEnv === 'function' && allowMissingEnv({ sourceLabel, valuePath, name })) {
      return ''
    }
    const location = valuePath ? `${sourceLabel}${valuePath}` : sourceLabel
    throw new Error(`${location}: missing environment variable "${name}".`)
  })
}

function resolveEnvPlaceholders(value, sourceLabel, valuePath = '', options = {}) {
  if (typeof value === 'string') {
    return expandEnvPlaceholdersInString(value, sourceLabel, valuePath, options)
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => resolveEnvPlaceholders(entry, sourceLabel, `${valuePath}[${index}]`, options))
  }

  if (value && typeof value === 'object') {
    const output = {}
    for (const [key, entry] of Object.entries(value)) {
      const nextPath = valuePath ? `${valuePath}.${key}` : `.${key}`
      output[key] = resolveEnvPlaceholders(entry, sourceLabel, nextPath, options)
    }
    return output
  }

  return value
}

function allowMissingTransportApiKeyEnv({ sourceLabel, valuePath }) {
  const isApiKeyPath = /\.apiKey$/i.test(String(valuePath ?? ''))
  if (!isApiKeyPath) return false

  if (sourceLabel === 'nextv.json' || sourceLabel === 'nerve.json') {
    return String(valuePath).startsWith('.transports.')
  }

  if (
    sourceLabel === 'nextv.json#transportsConfig'
    || sourceLabel === 'nerve.json#transportsConfig'
    || sourceLabel === 'transports.json'
  ) {
    return String(valuePath).startsWith('.transports.') || /^\.[^.]+\.apiKey$/i.test(String(valuePath))
  }

  return false
}

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

function parseTransportsMap(raw, sourceLabel) {
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.transports && typeof raw.transports === 'object' && !Array.isArray(raw.transports))
    ? raw.transports
    : raw

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${sourceLabel} must be an object map of transportName -> transportConfig.`)
  }

  for (const [name, transport] of Object.entries(map)) {
    if (!transport || typeof transport !== 'object' || Array.isArray(transport)) {
      throw new Error(`${sourceLabel}: transport "${name}" must be an object.`)
    }
    if (typeof transport.provider !== 'string' || !transport.provider.trim()) {
      throw new Error(`${sourceLabel}: transport "${name}.provider" must be a non-empty string.`)
    }
  }

  return map
}

function parseModelsMap(raw, sourceLabel) {
  const map = (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.models && typeof raw.models === 'object' && !Array.isArray(raw.models))
    ? raw.models
    : raw

  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${sourceLabel} must be an object map of modelName -> modelConfig.`)
  }

  for (const [name, model] of Object.entries(map)) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
      throw new Error(`${sourceLabel}: model "${name}" must be an object.`)
    }
    if (typeof model.model !== 'string' || !model.model.trim()) {
      throw new Error(`${sourceLabel}: model "${name}.model" must be a non-empty string.`)
    }
    if (typeof model.transport !== 'string' || !model.transport.trim()) {
      throw new Error(`${sourceLabel}: model "${name}.transport" must be a non-empty string.`)
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

function parseRequiresMap(raw, sourceLabel) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must be an object map of capability -> requirement.`)
  }

  const map = {}
  for (const [capabilityRaw, requirementRaw] of Object.entries(raw)) {
    const capability = String(capabilityRaw ?? '').trim()
    if (!capability) {
      throw new Error(`${sourceLabel}: capability names must be non-empty strings.`)
    }

    if (typeof requirementRaw === 'boolean') {
      map[capability] = {
        required: requirementRaw,
        provider: null,
      }
      continue
    }

    if (typeof requirementRaw === 'string') {
      const provider = requirementRaw.trim()
      if (!provider) {
        throw new Error(`${sourceLabel}: capability "${capability}" provider string must be non-empty.`)
      }
      map[capability] = {
        required: true,
        provider,
      }
      continue
    }

    if (!requirementRaw || typeof requirementRaw !== 'object' || Array.isArray(requirementRaw)) {
      throw new Error(
        `${sourceLabel}: capability "${capability}" requirement must be a boolean, string, or object.`,
      )
    }

    const required = requirementRaw.required == null ? true : requirementRaw.required === true
    if (requirementRaw.required != null && typeof requirementRaw.required !== 'boolean') {
      throw new Error(`${sourceLabel}: capability "${capability}.required" must be a boolean when provided.`)
    }

    const rawProvider = requirementRaw.provider ?? requirementRaw.module ?? null
    if (rawProvider != null && typeof rawProvider !== 'string') {
      throw new Error(`${sourceLabel}: capability "${capability}.provider" must be a string when provided.`)
    }

    const provider = String(rawProvider ?? '').trim() || null
    map[capability] = {
      required,
      provider,
    }
  }

  return map
}

function parseModulesMap(raw, sourceLabel) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${sourceLabel} must be an object map of module -> config.`)
  }

  const map = {}
  for (const [moduleNameRaw, moduleConfigRaw] of Object.entries(raw)) {
    const moduleName = String(moduleNameRaw ?? '').trim()
    if (!moduleName) {
      throw new Error(`${sourceLabel}: module names must be non-empty strings.`)
    }

    if (!moduleConfigRaw || typeof moduleConfigRaw !== 'object' || Array.isArray(moduleConfigRaw)) {
      throw new Error(`${sourceLabel}: module "${moduleName}" config must be an object.`)
    }

    const moduleConfig = { ...moduleConfigRaw }

    if (moduleConfig.provider != null && typeof moduleConfig.provider !== 'string') {
      throw new Error(`${sourceLabel}: module "${moduleName}.provider" must be a string when provided.`)
    }

    if (moduleConfig.endpoint != null && typeof moduleConfig.endpoint !== 'string') {
      throw new Error(`${sourceLabel}: module "${moduleName}.endpoint" must be a string when provided.`)
    }

    if (moduleConfig.mode != null) {
      if (typeof moduleConfig.mode !== 'string') {
        throw new Error(`${sourceLabel}: module "${moduleName}.mode" must be a string when provided.`)
      }
      const mode = moduleConfig.mode.trim().toLowerCase()
      if (!mode || (mode !== 'embedded' && mode !== 'external')) {
        throw new Error(`${sourceLabel}: module "${moduleName}.mode" must be either "embedded" or "external".`)
      }
      moduleConfig.mode = mode
    }

    if (moduleConfig.configPath != null && typeof moduleConfig.configPath !== 'string') {
      throw new Error(`${sourceLabel}: module "${moduleName}.configPath" must be a string when provided.`)
    }

    map[moduleName] = moduleConfig
  }

  return map
}

function isMcpProviderName(providerRaw) {
  const provider = String(providerRaw ?? '').trim().toLowerCase()
  return provider === 'mcp' || provider === 'mcp-client'
}

function isObjectMap(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function resolveModuleConfigReferences({
  modulesMap,
  sourceLabel,
  workspaceDir,
  resolvePathFromBaseDirectory,
  readJsonObjectFile,
}) {
  const resolvedModulesMap = {}

  for (const [moduleName, moduleConfigRaw] of Object.entries(modulesMap ?? {})) {
    const moduleConfig = isObjectMap(moduleConfigRaw) ? { ...moduleConfigRaw } : moduleConfigRaw
    if (!isObjectMap(moduleConfig)) {
      resolvedModulesMap[moduleName] = moduleConfigRaw
      continue
    }

    const configPathValue = moduleConfig.configPath
    const configPathFromConfigPath = typeof configPathValue === 'string' ? configPathValue.trim() : ''
    const configPathFromConfigAlias = typeof moduleConfig.config === 'string' ? moduleConfig.config.trim() : ''

    if (configPathFromConfigPath && configPathFromConfigAlias && configPathFromConfigPath !== configPathFromConfigAlias) {
      throw new Error(`${sourceLabel}: module "${moduleName}" must not define both "configPath" and "config" with different values.`)
    }

    const configPath = configPathFromConfigPath || configPathFromConfigAlias
    if (!configPath) {
      resolvedModulesMap[moduleName] = moduleConfig
      continue
    }

    const isMcpProvider = isMcpProviderName(moduleConfig.provider)

    if (isMcpProvider) {
      const conflictingInlineFields = ['servers']
        .filter((fieldName) => Object.prototype.hasOwnProperty.call(moduleConfig, fieldName))
      if (conflictingInlineFields.length > 0) {
        throw new Error(
          `${sourceLabel}: module "${moduleName}" must not define inline MCP fields (${conflictingInlineFields.join(', ')}) when external config is used.`,
        )
      }
    }

    const configFieldName = configPathFromConfigPath ? 'configPath' : 'config'
    const resolvedConfigPath = resolvePathFromBaseDirectory(workspaceDir.absolutePath, configPath, 'editor')
    if (!existsSync(resolvedConfigPath.absolutePath)) {
      throw new Error(`${sourceLabel}: module "${moduleName}.${configFieldName}" file not found: ${resolvedConfigPath.relativePath}`)
    }

    const externalRaw = readJsonObjectFile(resolvedConfigPath.absolutePath)
    const externalConfig = resolveEnvPlaceholders(
      externalRaw,
      `${sourceLabel}: module "${moduleName}.${configFieldName}"`,
      '',
      { allowMissingEnv: allowMissingTransportApiKeyEnv },
    )

    if (!isObjectMap(externalConfig)) {
      throw new Error(`${sourceLabel}: module "${moduleName}.${configFieldName}" must resolve to an object.`)
    }

    if (Object.prototype.hasOwnProperty.call(externalConfig, 'provider')) {
      throw new Error(`${sourceLabel}: module "${moduleName}.${configFieldName}" must not define "provider".`)
    }

    if (isMcpProvider) {
      const externalFieldNames = Object.keys(externalConfig)
      const invalidFields = externalFieldNames.filter((fieldName) => fieldName !== 'servers')
      if (invalidFields.length > 0) {
        throw new Error(
          `${sourceLabel}: module "${moduleName}.${configFieldName}" for MCP supports only "servers"; found: ${invalidFields.join(', ')}.`,
        )
      }

      const mergedModuleConfig = {
        ...moduleConfig,
        servers: externalConfig.servers,
        configPath,
      }

      if (Object.prototype.hasOwnProperty.call(mergedModuleConfig, 'config')) {
        delete mergedModuleConfig.config
      }

      resolvedModulesMap[moduleName] = mergedModuleConfig
      continue
    }

    const mergedModuleConfig = {
      ...moduleConfig,
      ...externalConfig,
      configPath,
    }

    if (Object.prototype.hasOwnProperty.call(mergedModuleConfig, 'config')) {
      delete mergedModuleConfig.config
    }

    resolvedModulesMap[moduleName] = mergedModuleConfig
  }

  return resolvedModulesMap
}

export function loadWorkspaceNextVConfig({
  workspaceDir,
  toWorkspaceDisplayPath,
  resolvePathFromBaseDirectory,
  readJsonObjectFile,
}) {
  const nervePath = join(workspaceDir.absolutePath, 'nerve.json')
  const nextVPath = join(workspaceDir.absolutePath, 'nextv.json')
  const rootConfigPath = existsSync(nervePath) ? nervePath : nextVPath
  const rootConfigLabel = existsSync(nervePath) ? 'nerve.json' : 'nextv.json'
  const rootConfigDisplayPath = toWorkspaceDisplayPath(rootConfigPath)
  const rootConfigRef = (suffix = '') => `${rootConfigLabel}${suffix}`
  const rootDisplayRef = (suffix = '') => `${rootConfigDisplayPath}${suffix}`
  const agentsPath = join(workspaceDir.absolutePath, 'agents.json')
  const modelsPath = join(workspaceDir.absolutePath, 'models.json')
  const transportsPath = join(workspaceDir.absolutePath, 'transports.json')
  const toolsPath = join(workspaceDir.absolutePath, 'tools.json')
  const operatorsPath = join(workspaceDir.absolutePath, 'operators.json')

  const config = {
    models: {
      status: 'missing',
      file: toWorkspaceDisplayPath(modelsPath),
      source: toWorkspaceDisplayPath(modelsPath),
      map: {},
    },
    transports: {
      status: 'missing',
      file: toWorkspaceDisplayPath(transportsPath),
      source: toWorkspaceDisplayPath(transportsPath),
      map: {},
    },
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
    nextv: { status: 'missing', file: rootConfigDisplayPath, config: {}, timers: [], timersSource: '' },
    operators: {
      status: 'missing',
      file: toWorkspaceDisplayPath(operatorsPath),
      source: toWorkspaceDisplayPath(operatorsPath),
      map: {},
    },
    effects: {
      status: 'missing',
      file: rootDisplayRef('#effects'),
      source: rootDisplayRef('#effects'),
      map: {},
    },
    requires: {
      status: 'missing',
      file: rootDisplayRef('#requires'),
      source: rootDisplayRef('#requires'),
      map: {},
    },
    modules: {
      status: 'missing',
      file: rootDisplayRef('#modules'),
      source: rootDisplayRef('#modules'),
      map: {},
    },
    runtime: {
      preload: 'none',
    },
  }

  if (existsSync(rootConfigPath)) {
    config.nextv.config = resolveEnvPlaceholders(readJsonObjectFile(rootConfigPath), rootConfigLabel, '', {
      allowMissingEnv: allowMissingTransportApiKeyEnv,
    })
    config.nextv.status = 'loaded'

    if (Object.prototype.hasOwnProperty.call(config.nextv.config, 'effectsPolicy')) {
      config.nextv.config.effectsPolicy = parseEffectsPolicy(config.nextv.config.effectsPolicy, rootConfigRef('#effectsPolicy'))
    }

    if (config.nextv.config.runtime != null) {
      const VALID_PRELOAD = new Set(['none', 'lazy', 'marked', 'all'])
      const rawPreload = config.nextv.config.runtime?.preload
      if (typeof rawPreload === 'string' && VALID_PRELOAD.has(rawPreload)) {
        config.runtime.preload = rawPreload
      }
    }

    if (config.nextv.config.models != null) {
      config.models.map = parseModelsMap(config.nextv.config.models, rootConfigRef('#models'))
      config.models.status = 'loaded'
      config.models.source = rootDisplayRef('#models')
    }

    if (config.nextv.config.transports != null) {
      config.transports.map = parseTransportsMap(config.nextv.config.transports, rootConfigRef('#transports'))
      config.transports.status = 'loaded'
      config.transports.source = rootDisplayRef('#transports')
    }

    if (config.nextv.config.agents != null) {
      config.agents.profiles = parseProfilesMap(config.nextv.config.agents, rootConfigRef('#agents'))
      config.agents.status = 'loaded'
      config.agents.source = rootDisplayRef('#agents')
    }

    if (config.nextv.config.tools != null) {
      const parsed = parseWorkspaceToolsConfig(config.nextv.config.tools, rootConfigRef('#tools'))
      config.tools.allow = parsed.allow
      config.tools.aliases = parsed.aliases
      config.tools.status = 'loaded'
      config.tools.source = rootDisplayRef('#tools')
    }

    if (config.nextv.config.operators != null) {
      config.operators.map = parseOperatorsMap(config.nextv.config.operators, rootConfigRef('#operators'))
      config.operators.status = 'loaded'
      config.operators.source = rootDisplayRef('#operators')
    }

    if (config.nextv.config.effects != null) {
      config.effects.map = parseEffectsMap(config.nextv.config.effects, rootConfigRef('#effects'))
      config.effects.status = 'loaded'
      config.effects.source = rootDisplayRef('#effects')
    }

    if (config.nextv.config.requires != null) {
      config.requires.map = parseRequiresMap(config.nextv.config.requires, rootConfigRef('#requires'))
      config.requires.status = 'loaded'
      config.requires.source = rootDisplayRef('#requires')
    }

    if (config.nextv.config.modules != null) {
      config.modules.map = resolveModuleConfigReferences({
        modulesMap: parseModulesMap(config.nextv.config.modules, rootConfigRef('#modules')),
        sourceLabel: rootConfigRef('#modules'),
        workspaceDir,
        resolvePathFromBaseDirectory,
        readJsonObjectFile,
      })
      config.modules.status = 'loaded'
      config.modules.source = rootDisplayRef('#modules')
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
      config.nextv.timersSource = rootDisplayRef('#timers')
    }

    const agentsConfigRef = String(config.nextv.config.agentsConfig ?? '').trim()
    const toolsConfigRef = String(config.nextv.config.toolsConfig ?? '').trim()
    const modelsConfigRef = String(config.nextv.config.modelsConfig ?? '').trim()
    const transportsConfigRef = String(config.nextv.config.transportsConfig ?? '').trim()
    const operatorsConfigRef = String(config.nextv.config.operatorsConfig ?? '').trim()

    if (modelsConfigRef) {
      const resolvedModels = resolvePathFromBaseDirectory(workspaceDir.absolutePath, modelsConfigRef, 'editor')
      if (!existsSync(resolvedModels.absolutePath)) {
        throw new Error(`${rootConfigRef('#modelsConfig')} file not found: ${resolvedModels.relativePath}`)
      }
      const modelsRaw = readJsonObjectFile(resolvedModels.absolutePath)
      config.models.map = parseModelsMap(
        resolveEnvPlaceholders(modelsRaw, rootConfigRef('#modelsConfig')),
        rootConfigRef('#modelsConfig'),
      )
      config.models.status = 'loaded'
      config.models.source = toWorkspaceDisplayPath(resolvedModels.absolutePath)
    }

    if (transportsConfigRef) {
      const resolvedTransports = resolvePathFromBaseDirectory(workspaceDir.absolutePath, transportsConfigRef, 'editor')
      if (!existsSync(resolvedTransports.absolutePath)) {
        throw new Error(`${rootConfigRef('#transportsConfig')} file not found: ${resolvedTransports.relativePath}`)
      }
      const transportsRaw = readJsonObjectFile(resolvedTransports.absolutePath)
      config.transports.map = parseTransportsMap(
        resolveEnvPlaceholders(transportsRaw, rootConfigRef('#transportsConfig'), '', {
          allowMissingEnv: allowMissingTransportApiKeyEnv,
        }),
        rootConfigRef('#transportsConfig'),
      )
      config.transports.status = 'loaded'
      config.transports.source = toWorkspaceDisplayPath(resolvedTransports.absolutePath)
    }

    if (agentsConfigRef) {
      const resolvedAgents = resolvePathFromBaseDirectory(workspaceDir.absolutePath, agentsConfigRef, 'editor')
      if (!existsSync(resolvedAgents.absolutePath)) {
        throw new Error(`${rootConfigRef('#agentsConfig')} file not found: ${resolvedAgents.relativePath}`)
      }
      const agentsRaw = readJsonObjectFile(resolvedAgents.absolutePath)
      config.agents.profiles = parseProfilesMap(
        resolveEnvPlaceholders(agentsRaw, rootConfigRef('#agentsConfig')),
        rootConfigRef('#agentsConfig'),
      )
      config.agents.status = 'loaded'
      config.agents.source = toWorkspaceDisplayPath(resolvedAgents.absolutePath)
    }

    if (toolsConfigRef) {
      const resolvedTools = resolvePathFromBaseDirectory(workspaceDir.absolutePath, toolsConfigRef, 'editor')
      if (!existsSync(resolvedTools.absolutePath)) {
        throw new Error(`${rootConfigRef('#toolsConfig')} file not found: ${resolvedTools.relativePath}`)
      }
      const toolsRaw = resolveEnvPlaceholders(
        JSON.parse(readFileSync(resolvedTools.absolutePath, 'utf8')),
        rootConfigRef('#toolsConfig'),
      )
      const parsed = parseWorkspaceToolsConfig(toolsRaw, rootConfigRef('#toolsConfig'))
      config.tools.allow = parsed.allow
      config.tools.aliases = parsed.aliases
      config.tools.status = 'loaded'
      config.tools.source = toWorkspaceDisplayPath(resolvedTools.absolutePath)
    }

    if (operatorsConfigRef) {
      const resolvedOperators = resolvePathFromBaseDirectory(workspaceDir.absolutePath, operatorsConfigRef, 'editor')
      if (!existsSync(resolvedOperators.absolutePath)) {
        throw new Error(`${rootConfigRef('#operatorsConfig')} file not found: ${resolvedOperators.relativePath}`)
      }
      const operatorsRaw = readJsonObjectFile(resolvedOperators.absolutePath)
      config.operators.map = parseOperatorsMap(
        resolveEnvPlaceholders(operatorsRaw, rootConfigRef('#operatorsConfig')),
        rootConfigRef('#operatorsConfig'),
      )
      config.operators.status = 'loaded'
      config.operators.source = toWorkspaceDisplayPath(resolvedOperators.absolutePath)
    }
  }

  if (config.models.status !== 'loaded' && existsSync(modelsPath)) {
    const raw = resolveEnvPlaceholders(readJsonObjectFile(modelsPath), 'models.json')
    config.models.map = parseModelsMap(raw, 'models.json')
    config.models.status = 'loaded'
    config.models.source = toWorkspaceDisplayPath(modelsPath)
  }

  if (config.transports.status !== 'loaded' && existsSync(transportsPath)) {
    const raw = resolveEnvPlaceholders(readJsonObjectFile(transportsPath), 'transports.json', '', {
      allowMissingEnv: allowMissingTransportApiKeyEnv,
    })
    config.transports.map = parseTransportsMap(raw, 'transports.json')
    config.transports.status = 'loaded'
    config.transports.source = toWorkspaceDisplayPath(transportsPath)
  }

  if (config.agents.status !== 'loaded' && existsSync(agentsPath)) {
    const raw = resolveEnvPlaceholders(readJsonObjectFile(agentsPath), 'agents.json')
    config.agents.profiles = parseProfilesMap(raw, 'agents.json')
    config.agents.status = 'loaded'
    config.agents.source = toWorkspaceDisplayPath(agentsPath)
  }

  if (config.tools.status !== 'loaded' && existsSync(toolsPath)) {
    const raw = resolveEnvPlaceholders(JSON.parse(readFileSync(toolsPath, 'utf8')), 'tools.json')
    const parsed = parseWorkspaceToolsConfig(raw, 'tools.json')
    config.tools.allow = parsed.allow
    config.tools.aliases = parsed.aliases
    config.tools.status = 'loaded'
    config.tools.source = toWorkspaceDisplayPath(toolsPath)
  }

  if (config.operators.status !== 'loaded' && existsSync(operatorsPath)) {
    const raw = resolveEnvPlaceholders(readJsonObjectFile(operatorsPath), 'operators.json')
    config.operators.map = parseOperatorsMap(raw, 'operators.json')
    config.operators.status = 'loaded'
    config.operators.source = toWorkspaceDisplayPath(operatorsPath)
  }

  return config
}

// When a transports registry is present in config, validate against it.
// When absent, fall back to the built-in set so existing configs without
// transports.json continue to work without errors.
const BUILTIN_TRANSPORTS = new Set(['ollama', 'llama.cpp', 'llama_cpp', 'openai'])

export function validateConfigReferences(workspaceConfig) {
  const issues = []
  const modelsMap = workspaceConfig?.models?.map ?? {}
  const transportsMap = workspaceConfig?.transports?.map ?? {}
  const hasTransportsRegistry = Object.keys(transportsMap).length > 0
  const effectiveTransports = hasTransportsRegistry
    ? new Set(Object.keys(transportsMap))
    : BUILTIN_TRANSPORTS

  for (const [modelName, model] of Object.entries(modelsMap)) {
    const transport = String(model?.transport ?? '').trim()
    if (transport && !effectiveTransports.has(transport)) {
      issues.push({
        code: 'TRANSPORT_NOT_FOUND',
        model: modelName,
        transport,
        message: `model "${modelName}" references unknown transport "${transport}"`,
      })
    }
  }

  return issues
}

export function validateNoForbiddenAgentFields(workspaceConfig) {
  const issues = []
  const agentsMap = workspaceConfig?.agents?.profiles ?? {}
  const forbiddenFields = ['transport']

  for (const [agentName, agent] of Object.entries(agentsMap)) {
    for (const field of forbiddenFields) {
      if (Object.prototype.hasOwnProperty.call(agent, field)) {
        issues.push({
          code: 'AGENT_INVALID_FIELD',
          agent: agentName,
          field,
          message: `agent "${agentName}" must not define "${field}" (use models registry instead)`,
        })
      }
    }
  }

  return issues
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

export function getConfiguredExternals(workspaceConfig) {
  const declared = Array.isArray(workspaceConfig?.nextv?.config?.externals)
    ? workspaceConfig.nextv.config.externals
    : []
  return [...new Set(declared.map((value) => String(value ?? '').trim()).filter(Boolean))]
}

export function getDeclaredEffectChannels(workspaceConfig) {
  const declared = workspaceConfig?.effects?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getRequiredCapabilities(workspaceConfig) {
  const declared = workspaceConfig?.requires?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getConfiguredModules(workspaceConfig) {
  const declared = workspaceConfig?.modules?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getConfiguredModelsMap(workspaceConfig) {
  const declared = workspaceConfig?.models?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getConfiguredAgentProfiles(workspaceConfig) {
  const declared = workspaceConfig?.agents?.profiles
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getConfiguredTransportsMap(workspaceConfig) {
  const declared = workspaceConfig?.transports?.map
  if (!declared || typeof declared !== 'object' || Array.isArray(declared)) return {}
  return { ...declared }
}

export function getConfiguredRuntimePreload(workspaceConfig) {
  const VALID = new Set(['none', 'lazy', 'marked', 'all'])
  const mode = workspaceConfig?.runtime?.preload
  return VALID.has(mode) ? mode : 'none'
}

