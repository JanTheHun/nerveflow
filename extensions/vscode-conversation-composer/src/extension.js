const vscode = require('vscode')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { ComposerClient } = require('./composerClient')
const { ComposerViewProvider } = require('./viewProvider')

function getRuntimeEndpoint() {
  const config = vscode.workspace.getConfiguration()
  return String(config.get('nerveflow.composerRuntimeEndpoint', 'ws://127.0.0.1:4190/api/runtime/ws'))
}

function getModelOptions() {
  const config = vscode.workspace.getConfiguration()
  const models = config.get('nerveflow.composerModels', ['qwen3-coder', 'llama3.1'])
  return Array.isArray(models)
    ? models.map((value) => String(value || '').trim()).filter(Boolean)
    : ['qwen3-coder', 'llama3.1']
}

function getWorkspaceDir() {
  const folder = vscode.workspace.workspaceFolders?.[0]
  return folder ? folder.uri.fsPath : ''
}

function getWorkspaceStorageKey() {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) {
    return ''
  }
  return String(folder.uri.toString(true) || '').trim()
}

function computeWorkspaceHash(key) {
  return createHash('sha1').update(String(key || '')).digest('hex').slice(0, 16)
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Nerveflow Conversation Composer')
  const getSessionRoot = () => {
    const key = getWorkspaceStorageKey()
    if (!key) {
      return ''
    }
    const hash = computeWorkspaceHash(key)
    return path.join(context.globalStorageUri.fsPath, 'workspaces', hash)
  }

  const composerClient = new ComposerClient({
    getEndpoint: getRuntimeEndpoint,
    getWorkspaceDir,
    getSessionRoot,
    getDefaultModel: () => getModelOptions()[0] || '',
  })

  const viewProvider = new ComposerViewProvider({
    extensionUri: context.extensionUri,
    composerClient,
    output,
    getModelOptions,
    getWorkspaceDir,
    getSessionRoot,
  })

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('conversationComposerView', viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('composer.initializeWorkspace', async () => {
      await viewProvider.initializeWorkspaceFromCommand()
    }),
    vscode.commands.registerCommand('composer.connectRuntime', async () => {
      await viewProvider.connectFromCommand()
    }),
    vscode.commands.registerCommand('composer.disconnectRuntime', async () => {
      await viewProvider.disconnectFromCommand()
    }),
    vscode.commands.registerCommand('composer.sendMessage', async () => {
      await viewProvider.sendFromCommand()
    }),
    {
      dispose: () => {
        composerClient.disconnect().catch(() => {})
      },
    }
  )
}

function deactivate() {
  return undefined
}

module.exports = {
  activate,
  deactivate,
}
