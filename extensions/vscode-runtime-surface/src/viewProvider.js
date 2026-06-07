const vscode = require('vscode')
const { randomBytes } = require('node:crypto')

function getNonce() {
  return randomBytes(16).toString('hex')
}

class RuntimeViewProvider {
  constructor({ extensionUri, runtimeClient, output }) {
    this.extensionUri = extensionUri
    this.runtimeClient = runtimeClient
    this.output = output
    this.view = null

    this.runtimeClient.on('status', (status) => {
      this.#post({ type: 'status', status })
      if (!status.connected) {
        this.output.appendLine('Runtime disconnected.')
      }
    })

    this.runtimeClient.on('error', (error) => {
      const message = error?.message || 'Unknown runtime client error.'
      this.output.appendLine(`[error] ${message}`)
      this.#post({ type: 'error', message })
    })

    this.runtimeClient.on('warning', (warning) => {
      const message = warning?.message || 'Runtime client warning.'
      this.output.appendLine(`[warning] ${message}`)
      this.#post({ type: 'error', message })
    })

    this.runtimeClient.on('runtimeEvent', (eventEnvelope) => {
      this.output.appendLine(`[${eventEnvelope.eventName}] ${JSON.stringify(eventEnvelope.payload)}`)
      this.#post({ type: 'runtimeEvent', eventEnvelope })
    })
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
    }

    webviewView.webview.html = this.#buildHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const msgType = String(message?.type || '')

      try {
        if (msgType === 'connect') {
          this.output.appendLine('[connect] requested from webview')
          const result = await this.runtimeClient.connect()
          this.output.appendLine(`Connected: ${result.endpoint}`)
          vscode.window.showInformationMessage('Nerveflow runtime connected.')
          this.#post({ type: 'connected', result })
          return
        }

        if (msgType === 'disconnect') {
          await this.runtimeClient.disconnect()
          vscode.window.showInformationMessage('Nerveflow runtime disconnected.')
          return
        }

        if (msgType === 'sendUserMessage') {
          const text = String(message?.text || '')
          await this.runtimeClient.sendUserMessage(text)
          this.output.appendLine(`[enqueue_event] user_message: ${text}`)
          this.#post({ type: 'commandOk', command: 'enqueue_event' })
          return
        }

        if (msgType === 'refreshSnapshot') {
          const response = await this.runtimeClient.refreshSnapshot()
          this.output.appendLine('[snapshot] received')
          this.#post({
            type: 'snapshot',
            snapshot: response?.data || {},
          })
          return
        }

        if (msgType === 'openSettings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', 'nerveflow.runtimeEndpoint')
        }
      } catch (error) {
        const errorMessage = error?.message || String(error)
        this.output.appendLine(`[error] ${errorMessage}`)
        vscode.window.showErrorMessage(`Nerveflow runtime: ${errorMessage}`)
        this.#post({ type: 'error', message: errorMessage })
      }
    })
  }

  async connectFromCommand() {
    await this.runtimeClient.connect()
  }

  async disconnectFromCommand() {
    await this.runtimeClient.disconnect()
  }

  async sendFromCommand() {
    const text = await vscode.window.showInputBox({
      prompt: 'Send user_message payload',
      placeHolder: 'hello world',
      ignoreFocusOut: true,
    })

    if (!text) {
      return
    }

    await this.runtimeClient.sendUserMessage(text)
    this.output.appendLine(`[enqueue_event] user_message: ${text}`)
  }

  async refreshSnapshotFromCommand() {
    const response = await this.runtimeClient.refreshSnapshot()
    this.#post({ type: 'snapshot', snapshot: response?.data || {} })
    this.output.appendLine('[snapshot] refreshed from command')
  }

  #post(message) {
    if (!this.view) {
      return
    }
    this.view.webview.postMessage(message)
  }

  #buildHtml(webview) {
    const nonce = getNonce()

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Nerveflow Runtime Surface</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 10px; }
    button { margin-right: 6px; margin-top: 6px; }
    textarea, pre, input { width: 100%; box-sizing: border-box; }
    textarea { min-height: 70px; }
    .status { margin-top: 8px; font-weight: 600; }
    .panel { margin-top: 12px; }
    .tabbar { display: flex; gap: 6px; margin-top: 12px; }
    .tab { margin: 0; padding: 6px 10px; border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .tab.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .tabpanel[hidden] { display: none; }
    pre { background: var(--vscode-editor-background); padding: 8px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <h3>Nerveflow Runtime</h3>
  <div>
    <button id="connect">Connect</button>
    <button id="disconnect">Disconnect</button>
    <button id="snapshot">Refresh Snapshot</button>
    <button id="settings">Endpoint Setting</button>
    <button id="clearStream">Clear Output Stream</button>
  </div>
  <div class="status" id="status">○ Disconnected</div>

  <div class="panel">
    <label for="message">Message</label>
    <textarea id="message" placeholder="hello world"></textarea>
    <button id="send">Send user_message</button>
  </div>

  <div class="tabbar" role="tablist" aria-label="Runtime data tabs">
    <button id="tabStream" class="tab active" role="tab" aria-selected="true">Output Stream</button>
    <button id="tabOutputs" class="tab" role="tab" aria-selected="false">Outputs</button>
    <button id="tabSnapshot" class="tab" role="tab" aria-selected="false">Snapshot</button>
  </div>

  <div class="panel tabpanel" id="panelStream" role="tabpanel" aria-labelledby="tabStream">
    <pre id="stream">(waiting for events)</pre>
  </div>

  <div class="panel tabpanel" id="panelOutputs" role="tabpanel" aria-labelledby="tabOutputs" hidden>
    <pre id="outputs">(no outputs yet)</pre>
  </div>

  <div class="panel tabpanel" id="panelSnapshot" role="tabpanel" aria-labelledby="tabSnapshot" hidden>
    <pre id="snapshotData">(none yet)</pre>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const streamEl = document.getElementById('stream')
    const outputsEl = document.getElementById('outputs')
    const snapshotEl = document.getElementById('snapshotData')
    const statusEl = document.getElementById('status')
    const messageEl = document.getElementById('message')
    const tabStream = document.getElementById('tabStream')
    const tabOutputs = document.getElementById('tabOutputs')
    const tabSnapshot = document.getElementById('tabSnapshot')
    const panelStream = document.getElementById('panelStream')
    const panelOutputs = document.getElementById('panelOutputs')
    const panelSnapshot = document.getElementById('panelSnapshot')

    function setActiveTab(tabName) {
      const isStream = tabName === 'stream'
      const isOutputs = tabName === 'outputs'
      const isSnapshot = tabName === 'snapshot'

      tabStream.classList.toggle('active', isStream)
      tabOutputs.classList.toggle('active', isOutputs)
      tabSnapshot.classList.toggle('active', isSnapshot)

      tabStream.setAttribute('aria-selected', String(isStream))
      tabOutputs.setAttribute('aria-selected', String(isOutputs))
      tabSnapshot.setAttribute('aria-selected', String(isSnapshot))

      panelStream.hidden = !isStream
      panelOutputs.hidden = !isOutputs
      panelSnapshot.hidden = !isSnapshot
    }

    function asPretty(value) {
      if (value == null) return ''
      if (typeof value === 'string') return value
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }

    function appendOutput(format, value, source) {
      const label = String(format || 'unknown')
      const origin = String(source || 'runtime')
      const rendered = asPretty(value)
      if (outputsEl.textContent === '(no outputs yet)') {
        outputsEl.textContent = ''
      }
      outputsEl.textContent += '[' + origin + '] ' + label + '\\n' + rendered + '\\n\\n'
    }

    function extractOutputs(eventEnvelope) {
      const payload = eventEnvelope?.payload || {}
      const eventName = String(eventEnvelope?.eventName || '')

      if (eventName === 'nextv_execution') {
        const outputs = payload?.result?.outputs
        if (Array.isArray(outputs)) {
          for (const item of outputs) {
            appendOutput(item?.format || item?.type, item?.content ?? item?.value ?? item, 'nextv_execution')
          }
        }
      }

      if (eventName === 'nextv_runtime_event') {
        const runtimeEvent = payload?.runtimeEvent
        if (runtimeEvent && runtimeEvent.type === 'output') {
          appendOutput(runtimeEvent.format || runtimeEvent.type, runtimeEvent.content ?? runtimeEvent.value ?? runtimeEvent, 'nextv_runtime_event')
        }
      }
    }

    document.getElementById('connect').addEventListener('click', () => {
      statusEl.textContent = '◌ Connecting...'
      streamEl.textContent += '\\n[ui] connect clicked\\n'
      vscode.postMessage({ type: 'connect' })
    })

    document.getElementById('disconnect').addEventListener('click', () => {
      streamEl.textContent += '\\n[ui] disconnect clicked\\n'
      vscode.postMessage({ type: 'disconnect' })
    })

    document.getElementById('snapshot').addEventListener('click', () => {
      streamEl.textContent += '\\n[ui] snapshot requested\\n'
      vscode.postMessage({ type: 'refreshSnapshot' })
    })

    document.getElementById('settings').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' })
    })

    document.getElementById('clearStream').addEventListener('click', () => {
      streamEl.textContent = '(cleared)'
    })

    document.getElementById('send').addEventListener('click', () => {
      streamEl.textContent += '\\n[ui] send_user_message clicked\\n'
      vscode.postMessage({ type: 'sendUserMessage', text: messageEl.value })
    })

    tabStream.addEventListener('click', () => setActiveTab('stream'))
    tabOutputs.addEventListener('click', () => setActiveTab('outputs'))
    tabSnapshot.addEventListener('click', () => setActiveTab('snapshot'))

    window.addEventListener('message', (event) => {
      const message = event.data || {}

      if (message.type === 'status') {
        if (message.status?.connecting) {
          statusEl.textContent = '◌ Connecting...'
        } else {
          statusEl.textContent = message.status?.connected ? '● Connected' : '○ Disconnected'
        }
      }

      if (message.type === 'runtimeEvent') {
        const ts = message.eventEnvelope?.timestamp || new Date().toISOString()
        const name = message.eventEnvelope?.eventName || 'event'
        const payload = JSON.stringify(message.eventEnvelope?.payload || {}, null, 2)
        streamEl.textContent += '\\n' + ts + ' ' + name + '\\n' + payload + '\\n'
        extractOutputs(message.eventEnvelope)
      }

      if (message.type === 'snapshot') {
        snapshotEl.textContent = JSON.stringify(message.snapshot || {}, null, 2)
      }

      if (message.type === 'error') {
        streamEl.textContent += '\\nERROR: ' + (message.message || 'unknown error') + '\\n'
      }
    })

    setActiveTab('stream')
  </script>
</body>
</html>`
  }
}

module.exports = {
  RuntimeViewProvider,
}
