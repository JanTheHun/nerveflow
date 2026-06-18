const fs = require('node:fs/promises')
const path = require('node:path')

const LOCAL_ENV_FILENAME = 'env.local.json'

function normalizeProvider(provider) {
  return String(provider || '').trim().toLowerCase()
}

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  return value
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function buildTransportConfig({ provider, baseUrl, apiKeyEnvVar }) {
  const normalizedProvider = normalizeProvider(provider)
  const config = { provider: normalizedProvider }
  if (baseUrl) {
    config.baseUrl = String(baseUrl).trim()
  }
  if (apiKeyEnvVar) {
    const keyName = String(apiKeyEnvVar).trim()
    if (keyName) {
      config.apiKey = `\${env:${keyName}}`
    }
  }
  return config
}

function buildModelConfig({ transport, model }) {
  return {
    transport: String(transport || '').trim(),
    model: String(model || '').trim(),
  }
}

async function upsertEnvValues(workspaceFolder, entries) {
  const envPath = path.join(workspaceFolder, LOCAL_ENV_FILENAME)
  const existing = asObject(await readJsonIfExists(envPath))
  const existingKeys = new Set(Object.keys(existing))

  const toAppend = []
  const nextEnv = { ...existing }
  for (const item of entries) {
    const key = String(item?.key || '').trim()
    if (!key || existingKeys.has(key)) {
      continue
    }
    const value = String(item?.value || '').trim()
    toAppend.push(key)
    nextEnv[key] = value
    existingKeys.add(key)
  }

  if (toAppend.length === 0) {
    return { path: envPath, updated: false, appendedKeys: [] }
  }

  await fs.mkdir(workspaceFolder, { recursive: true })
  await writeJson(envPath, nextEnv)
  return {
    path: envPath,
    updated: true,
    appendedKeys: toAppend,
  }
}

function resolveRegistryWriteTarget({ rootConfigPath, rootConfig, standalonePath, key }) {
  const rawRoot = asObject(rootConfig)
  if (rawRoot[key] && typeof rawRoot[key] === 'object' && !Array.isArray(rawRoot[key])) {
    return {
      kind: 'inline',
      path: rootConfigPath,
    }
  }
  return {
    kind: 'standalone',
    path: standalonePath,
  }
}

async function loadRootConfig(workspaceFolder) {
  const nervePath = path.join(workspaceFolder, 'nerve.json')
  const nextvPath = path.join(workspaceFolder, 'nextv.json')
  const nerve = await readJsonIfExists(nervePath)
  if (nerve) {
    return { path: nervePath, config: nerve }
  }
  const nextv = await readJsonIfExists(nextvPath)
  if (nextv) {
    return { path: nextvPath, config: nextv }
  }
  return { path: nervePath, config: null }
}

async function upsertRegistryEntry({
  workspaceFolder,
  key,
  entryName,
  entryValue,
  rootConfigPath,
  rootConfig,
}) {
  const standalonePath = path.join(workspaceFolder, `${key}.json`)
  const target = resolveRegistryWriteTarget({
    rootConfigPath,
    rootConfig,
    standalonePath,
    key,
  })

  if (target.kind === 'inline') {
    const nextRoot = asObject(rootConfig)
    nextRoot[key] = asObject(nextRoot[key])
    nextRoot[key][entryName] = entryValue
    await writeJson(rootConfigPath, nextRoot)
    return { kind: target.kind, path: target.path }
  }

  const standaloneConfig = asObject(await readJsonIfExists(standalonePath))
  standaloneConfig[entryName] = entryValue
  await writeJson(standalonePath, standaloneConfig)
  return { kind: target.kind, path: target.path }
}

function validateSetupInput(input) {
  const provider = normalizeProvider(input?.provider)
  const transportName = String(input?.transportName || '').trim()
  const modelAlias = String(input?.modelAlias || '').trim()
  const model = String(input?.model || '').trim()
  const apiKeyEnvVar = String(input?.apiKeyEnvVar || '').trim()

  if (!provider) {
    throw new Error('provider is required.')
  }
  if (!transportName) {
    throw new Error('transportName is required.')
  }
  if (!modelAlias) {
    throw new Error('modelAlias is required.')
  }
  if (!model) {
    throw new Error('model is required.')
  }

  return {
    provider,
    transportName,
    modelAlias,
    model,
    baseUrl: String(input?.baseUrl || '').trim(),
    apiKeyEnvVar,
    apiKeyValue: String(input?.apiKeyValue || '').trim(),
  }
}

async function applySetup(workspaceFolder, input) {
  const normalized = validateSetupInput(input)
  const rootInfo = await loadRootConfig(workspaceFolder)

  const transportTarget = await upsertRegistryEntry({
    workspaceFolder,
    key: 'transports',
    entryName: normalized.transportName,
    entryValue: buildTransportConfig(normalized),
    rootConfigPath: rootInfo.path,
    rootConfig: rootInfo.config,
  })

  const rootAfterTransport = await readJsonIfExists(rootInfo.path)
  const modelTarget = await upsertRegistryEntry({
    workspaceFolder,
    key: 'models',
    entryName: normalized.modelAlias,
    entryValue: buildModelConfig({
      transport: normalized.transportName,
      model: normalized.model,
    }),
    rootConfigPath: rootInfo.path,
    rootConfig: rootAfterTransport,
  })

  const envEntries = []
  if (normalized.apiKeyEnvVar && normalized.apiKeyValue) {
    envEntries.push({ key: normalized.apiKeyEnvVar, value: normalized.apiKeyValue })
  }
  if (normalized.baseUrl) {
    const key = `${normalized.transportName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BASE_URL`
    envEntries.push({ key, value: normalized.baseUrl })
  }

  const envResult = await upsertEnvValues(workspaceFolder, envEntries)

  return {
    modelAlias: normalized.modelAlias,
    transportName: normalized.transportName,
    writes: {
      transport: transportTarget,
      model: modelTarget,
      env: envResult,
    },
  }
}

module.exports = {
  applySetup,
  buildModelConfig,
  buildTransportConfig,
  LOCAL_ENV_FILENAME,
  loadRootConfig,
  resolveRegistryWriteTarget,
  upsertEnvValues,
  validateSetupInput,
}
