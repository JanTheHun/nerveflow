const vscode = require('vscode')
const { RuntimeClient } = require('./runtimeClient')
const { RuntimeViewProvider } = require('./viewProvider')

function getRuntimeEndpoint() {
  const config = vscode.workspace.getConfiguration()
  return String(config.get('nerveflow.runtimeEndpoint', 'ws://127.0.0.1:4190/api/runtime/ws'))
}

function activate(context) {
  const output = vscode.window.createOutputChannel('Nerveflow Runtime Surface')
  const runtimeClient = new RuntimeClient({ getEndpoint: getRuntimeEndpoint })

  const viewProvider = new RuntimeViewProvider({
    extensionUri: context.extensionUri,
    runtimeClient,
    output,
  })

  context.subscriptions.push(
    output,
    vscode.window.registerWebviewViewProvider('nerveflowRuntimeView', viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('nerveflow.connectRuntime', async () => {
      await viewProvider.connectFromCommand()
      output.appendLine('Connected via command.')
    }),
    vscode.commands.registerCommand('nerveflow.disconnectRuntime', async () => {
      await viewProvider.disconnectFromCommand()
      output.appendLine('Disconnected via command.')
    }),
    vscode.commands.registerCommand('nerveflow.sendUserMessage', async () => {
      await viewProvider.sendFromCommand()
    }),
    vscode.commands.registerCommand('nerveflow.refreshSnapshot', async () => {
      await viewProvider.refreshSnapshotFromCommand()
    }),
    {
      dispose: () => {
        runtimeClient.disconnect().catch(() => {})
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
