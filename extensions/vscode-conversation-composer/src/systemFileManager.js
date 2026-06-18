const fs = require('node:fs/promises')
const { loadConfig, saveConfig } = require('./composerConfig')

function normalizeAbsolutePath(absolutePath) {
  return String(absolutePath || '').trim()
}

async function addSystemFile(workspaceFolder, absolutePath) {
  const config = await loadConfig(workspaceFolder)
  const canonicalPath = normalizeAbsolutePath(absolutePath)
  if (!canonicalPath) {
    return saveConfig(workspaceFolder, config)
  }

  if (!config.system.includes(canonicalPath)) {
    config.system.push(canonicalPath)
  }
  return saveConfig(workspaceFolder, config)
}

async function removeSystemFile(workspaceFolder, relPath) {
  const config = await loadConfig(workspaceFolder)
  config.system = config.system.filter((entry) => entry !== relPath)
  return saveConfig(workspaceFolder, config)
}

async function reorderSystemFiles(workspaceFolder, orderedList) {
  const config = await loadConfig(workspaceFolder)
  const nextOrder = Array.isArray(orderedList) ? orderedList : []
  const known = new Set(config.system)
  config.system = nextOrder.filter((entry) => known.has(entry))
  for (const entry of known) {
    if (!config.system.includes(entry)) {
      config.system.push(entry)
    }
  }
  return saveConfig(workspaceFolder, config)
}

async function getSystemFileContents(workspaceFolder, relPath) {
  return fs.readFile(relPath, 'utf8')
}

module.exports = {
  addSystemFile,
  getSystemFileContents,
  removeSystemFile,
  reorderSystemFiles,
}
