const fs = require('node:fs/promises')
const path = require('node:path')
const { initializeConfig, loadConfig, getConfigPath } = require('./composerConfig')
const { generateWorkflow } = require('./workflowGenerator')

const DEFAULT_TRANSPORT_NAME = 'composer-default'

async function ensureFileIfMissing(targetPath, content) {
  try {
    await fs.access(targetPath)
  } catch {
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, content, 'utf8')
  }
}

function getModelList(models) {
  const candidates = Array.isArray(models)
    ? models.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  if (candidates.length > 0) {
    return candidates
  }
  return ['qwen3-coder']
}

function buildDefaultModelsConfig(models) {
  const entries = {}
  for (const model of getModelList(models)) {
    entries[model] = {
      transport: DEFAULT_TRANSPORT_NAME,
      model,
    }
  }
  return entries
}

function buildDefaultTransportsConfig() {
  return {
    [DEFAULT_TRANSPORT_NAME]: {
      provider: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
    },
  }
}

function buildDefaultNextvConfig() {
  return {
    entrypointPath: 'capabilities/conversation.nrv',
    modelsConfig: 'models.json',
    transportsConfig: 'transports.json',
  }
}

async function initializeWorkspace(workspaceFolder, models = []) {
  await fs.mkdir(workspaceFolder, { recursive: true })
  await fs.mkdir(path.join(workspaceFolder, 'capabilities'), { recursive: true })
  await fs.mkdir(path.join(workspaceFolder, 'conversations'), { recursive: true })

  await ensureFileIfMissing(path.join(workspaceFolder, 'conversations', 'default.jsonl'), '')
  await ensureFileIfMissing(path.join(workspaceFolder, 'transports.json'), `${JSON.stringify(buildDefaultTransportsConfig(), null, 2)}\n`)
  await ensureFileIfMissing(path.join(workspaceFolder, 'models.json'), `${JSON.stringify(buildDefaultModelsConfig(models), null, 2)}\n`)
  await ensureFileIfMissing(path.join(workspaceFolder, 'nextv.json'), `${JSON.stringify(buildDefaultNextvConfig(), null, 2)}\n`)

  let config
  try {
    config = await loadConfig(workspaceFolder)
  } catch {
    config = await initializeConfig(workspaceFolder, models)
  }

  await generateWorkflow(workspaceFolder, config)

  return {
    config,
    configPath: getConfigPath(workspaceFolder),
  }
}

module.exports = {
  initializeWorkspace,
}
