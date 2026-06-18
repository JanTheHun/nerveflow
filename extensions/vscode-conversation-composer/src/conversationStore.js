const fs = require('node:fs/promises')
const path = require('node:path')

function resolveConversationPath(workspaceFolder, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/')
  return path.join(workspaceFolder, normalized)
}

async function loadConversation(workspaceFolder, relativePath) {
  const targetPath = resolveConversationPath(workspaceFolder, relativePath)
  try {
    const content = await fs.readFile(targetPath, 'utf8')
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

async function appendConversationMessages(workspaceFolder, relativePath, messages) {
  const targetPath = resolveConversationPath(workspaceFolder, relativePath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const lines = messages.map((message) => JSON.stringify(message)).join('\n')
  const payload = lines ? `${lines}\n` : ''
  if (!payload) {
    return
  }
  await fs.appendFile(targetPath, payload, 'utf8')
}

async function clearConversation(workspaceFolder, relativePath) {
  const targetPath = resolveConversationPath(workspaceFolder, relativePath)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.writeFile(targetPath, '', 'utf8')
}

module.exports = {
  appendConversationMessages,
  clearConversation,
  loadConversation,
  resolveConversationPath,
}
