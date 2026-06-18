const fs = require('node:fs/promises')
const path = require('node:path')

const CONFIG_VERSION = '1.0'
const CONFIG_FILENAME = 'config.json'
const DEFAULT_CONVERSATION_PATH = 'conversations/default.jsonl'

const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  model: 'qwen3-coder',
  system: [],
  tools: {
    enabled: [],
    disabled: [],
  },
  conversation: DEFAULT_CONVERSATION_PATH,
})

function getConfigPath(workspaceFolder) {
  return path.join(workspaceFolder, CONFIG_FILENAME)
}

function toPosixRelative(rawPath) {
  return String(rawPath || '').replace(/\\/g, '/')
}

function validateString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function validateConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new Error('Composer config must be an object.')
  }

  const version = validateString(rawConfig.version || CONFIG_VERSION, 'version')
  const model = validateString(rawConfig.model, 'model')

  if (!Array.isArray(rawConfig.system)) {
    throw new Error('system must be an array of relative markdown paths.')
  }
  const system = rawConfig.system.map((entry) => toPosixRelative(validateString(entry, 'system entry')))

  const toolsRaw = rawConfig.tools || {}
  const enabledRaw = Array.isArray(toolsRaw.enabled) ? toolsRaw.enabled : []
  const disabledRaw = Array.isArray(toolsRaw.disabled) ? toolsRaw.disabled : []
  const tools = {
    enabled: enabledRaw.map((entry) => validateString(entry, 'tools.enabled entry')),
    disabled: disabledRaw.map((entry) => validateString(entry, 'tools.disabled entry')),
  }

  const conversation = toPosixRelative(validateString(rawConfig.conversation || DEFAULT_CONVERSATION_PATH, 'conversation'))

  return {
    version,
    model,
    system,
    tools,
    conversation,
  }
}

async function loadConfig(workspaceFolder) {
  const configPath = getConfigPath(workspaceFolder)
  const raw = await fs.readFile(configPath, 'utf8')
  const parsed = JSON.parse(raw)
  return validateConfig(parsed)
}

async function saveConfig(workspaceFolder, config) {
  const configPath = getConfigPath(workspaceFolder)
  const normalized = validateConfig(config)
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8')
  return normalized
}

function createDefaultConfig(models = []) {
  const modelCandidates = Array.isArray(models)
    ? models.map((value) => String(value || '').trim()).filter(Boolean)
    : []

  const selectedModel = modelCandidates[0] || DEFAULT_CONFIG.model
  return {
    ...DEFAULT_CONFIG,
    model: selectedModel,
    system: [],
    tools: {
      enabled: [],
      disabled: [],
    },
  }
}

async function initializeConfig(workspaceFolder, models = []) {
  const defaults = createDefaultConfig(models)
  return saveConfig(workspaceFolder, defaults)
}

module.exports = {
  CONFIG_FILENAME,
  DEFAULT_CONVERSATION_PATH,
  DEFAULT_CONFIG,
  createDefaultConfig,
  getConfigPath,
  initializeConfig,
  loadConfig,
  saveConfig,
  validateConfig,
}
