const path = require('node:path')
const vscode = require('vscode')
const { randomBytes } = require('node:crypto')
const { initializeWorkspace } = require('./workspaceInitializer')
const { appendConversationMessages, clearConversation, loadConversation } = require('./conversationStore')
const { generateWorkflow } = require('./workflowGenerator')
const { addSystemFile, removeSystemFile, reorderSystemFiles } = require('./systemFileManager')
const { loadConfig, saveConfig } = require('./composerConfig')
const { normalizeRuntimeErrorEvent } = require('./runtimeErrorUtils')

function getNonce() {
  return randomBytes(16).toString('hex')
}

function nowIso() {
  return new Date().toISOString()
}

function getWorkspaceFolder() {
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (!folder) {
    throw new Error('Open a workspace folder before using Conversation Composer.')
  }
  return folder.uri.fsPath
}

function extractAssistantText(eventEnvelope) {
  const payload = eventEnvelope?.payload || {}

  // Primary path: payload.events[] from nextv_execution contains the runtime events
  // emitted during the turn (output text / output json / output voice etc.)
  const events = payload?.events
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (String(ev?.type || '').trim() !== 'output') continue
      const format = String(ev?.format || '').toLowerCase().trim()
      const content = ev?.content ?? null

      if (format === 'text' || format === 'voice' || format === 'console') {
        if (typeof content === 'string' && content.trim()) return content
      }

      if (format === 'json' || format === 'interaction') {
        // value field is set for json/interaction; content may be a string repr
        const valueField = ev?.value ?? content
        if (valueField && typeof valueField === 'object' && typeof valueField.text === 'string' && valueField.text.trim()) {
          return valueField.text
        }
        if (typeof content === 'string') {
          try {
            const parsed = JSON.parse(content)
            if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text
          } catch {
            // no-op
          }
        }
      }
    }
  }

  // Legacy fallback: older payload shape with result.outputs
  const outputs = payload?.result?.outputs
  if (Array.isArray(outputs)) {
    for (const item of outputs) {
      const value = item?.content ?? item?.value ?? null
      const format = String(item?.format || item?.type || '').toLowerCase()

      if (format === 'json') {
        if (value && typeof value === 'object' && typeof value.text === 'string' && value.text.trim()) {
          return value.text
        }
        if (typeof value === 'string') {
          try {
            const parsed = JSON.parse(value)
            if (typeof parsed?.text === 'string' && parsed.text.trim()) return parsed.text
          } catch {
            // no-op
          }
        }
        continue
      }

      if (typeof value === 'string' && value.trim()) return value
    }
  }

  return null
}

function formatTraceLine(trace) {
  const kind = String(trace?.kind || 'unknown')
  const details = []
  const pushDetail = (key, value) => {
    if (value === undefined || value === null || value === '') return
    details.push(`${key}=${String(value)}`)
  }

  pushDetail('type', trace?.type)
  pushDetail('requestId', trace?.requestId)
  pushDetail('event', trace?.eventName)
  pushDetail('seq', trace?.sequence)
  pushDetail('elapsedMs', trace?.elapsedMs)
  pushDetail('timeoutMs', trace?.timeoutMs)
  pushDetail('sessionId', trace?.sessionId)
  pushDetail('endpoint', trace?.endpoint)
  pushDetail('error', trace?.error)

  if (trace?.payloadSummary && typeof trace.payloadSummary === 'object') {
    const payloadKeys = Array.isArray(trace.payloadSummary.keys)
      ? trace.payloadSummary.keys.join(',')
      : ''
    pushDetail('payloadKeys', payloadKeys)
    pushDetail('payloadValueLength', trace.payloadSummary.valueLength)
    pushDetail('payloadEventType', trace.payloadSummary.eventType)
  }

  return `[composer][trace] ${kind}${details.length ? ` ${details.join(' ')}` : ''}`
}

class ComposerViewProvider {
  constructor({ extensionUri, composerClient, output, getModelOptions, getWorkspaceDir, getSessionRoot }) {
    this.extensionUri = extensionUri
    this.composerClient = composerClient
    this.output = output
    this.getModelOptions = getModelOptions
    this.getWorkspaceDir = getWorkspaceDir
    this.getSessionRoot = getSessionRoot
    this.view = null
    this.state = {
      workspaceReady: false,
      config: null,
      conversation: [],
      availableTools: [],
      models: this.getModelOptions(),
      connected: false,
      connecting: false,
      runtimeErrors: [],
      lastError: null,
    }

    this.composerClient.on('status', (status) => {
      this.state.connected = Boolean(status?.connected)
      this.state.connecting = Boolean(status?.connecting)
      this.output.appendLine(`[composer][status] connected=${this.state.connected} connecting=${this.state.connecting} endpoint=${String(status?.endpoint || '')} sessionId=${String(status?.sessionId || '')} embeddedRuntime=${status?.embeddedRuntime === true}`)
      this.#postState()
    })

    this.composerClient.on('trace', (trace) => {
      this.output.appendLine(formatTraceLine(trace))
    })

    this.composerClient.on('error', (error) => {
      const message = error?.message || 'Unknown runtime client error.'
      this.output.appendLine(`[error] ${message}`)
      this.#post({ type: 'error', message })
    })

    this.composerClient.on('runtimeEvent', async (eventEnvelope) => {
      this.#post({ type: 'runtimeEvent', eventEnvelope })
      this.output.appendLine(`[composer][event] name=${String(eventEnvelope?.eventName || 'unknown_event')} seq=${Number.isFinite(Number(eventEnvelope?.sequence)) ? Number(eventEnvelope.sequence) : '?'} hasPayload=${Boolean(eventEnvelope?.payload)}`)

      const runtimeError = normalizeRuntimeErrorEvent(eventEnvelope)
      if (runtimeError) {
        const withTimestamp = {
          ...runtimeError,
          timestamp: runtimeError.timestamp || nowIso(),
        }

        this.state.runtimeErrors.push(withTimestamp)
        if (this.state.runtimeErrors.length > 100) {
          this.state.runtimeErrors = this.state.runtimeErrors.slice(-100)
        }
        this.state.lastError = withTimestamp

        this.output.appendLine(`[nextv_error] ${withTimestamp.code}: ${withTimestamp.message}`)
        if (withTimestamp.sourcePath) {
          const sourceLine = Number.isFinite(withTimestamp.sourceLine) ? withTimestamp.sourceLine : '?'
          this.output.appendLine(`  at ${withTimestamp.sourcePath}:${sourceLine}`)
        }
        if (withTimestamp.statement) {
          this.output.appendLine(`  ${withTimestamp.statement}`)
        }
        if (withTimestamp.guidance) {
          this.output.appendLine(`  guidance: ${withTimestamp.guidance}`)
        }

        this.#postState()
        return
      }

      if (eventEnvelope?.eventName !== 'nextv_execution') {
        return
      }

      const assistantText = extractAssistantText(eventEnvelope)
      if (!assistantText) {
        const eventsCount = Array.isArray(eventEnvelope?.payload?.events) ? eventEnvelope.payload.events.length : 'none'
        const outputEvents = Array.isArray(eventEnvelope?.payload?.events)
          ? eventEnvelope.payload.events.filter((ev) => ev?.type === 'output').map((ev) => `${ev.format}:${typeof ev.content}`)
          : []
        this.output.appendLine(`[composer][event] nextv_execution: no parseable assistant text — events=${eventsCount} outputEvents=[${outputEvents.join(', ')}]`)
        return
      }

      this.output.appendLine(`[composer][event] nextv_execution assistant text extracted length=${assistantText.length}`)

      const message = {
        role: 'assistant',
        content: assistantText,
        timestamp: nowIso(),
      }
      this.state.conversation.push(message)
      await this.#appendConversation([message])
      this.#postState()
    })
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webview'),
      ],
    }

    webviewView.webview.html = this.#buildHtml(webviewView.webview)

    webviewView.webview.onDidReceiveMessage(async (message) => {
      const msgType = String(message?.type || '')
      try {
        if (msgType === 'initializeWorkspace') {
          await this.#initializeWorkspaceAndReload()
          return
        }

        if (msgType === 'connectRuntime') {
          await this.connectFromCommand()
          return
        }

        if (msgType === 'disconnectRuntime') {
          await this.disconnectFromCommand()
          return
        }

        if (msgType === 'refreshState') {
          await this.#refreshState()
          return
        }

        if (msgType === 'sendMessage') {
          await this.#sendMessage(String(message?.text || ''))
          return
        }

        if (msgType === 'clearConversation') {
          await this.#clearConversation()
          return
        }

        if (msgType === 'addSystemFile') {
          await this.#addSystemFileFromPicker()
          return
        }

        if (msgType === 'removeSystemFile') {
          await this.#removeSystemFile(String(message?.path || ''))
          return
        }

        if (msgType === 'moveSystemFile') {
          const items = Array.isArray(message?.items) ? message.items.map((value) => String(value || '')) : []
          await this.#moveSystemFile(items)
          return
        }

        if (msgType === 'setModel') {
          await this.#setModel(String(message?.model || ''))
          return
        }

        if (msgType === 'toggleTool') {
          await this.#toggleTool(String(message?.tool || ''), Boolean(message?.enabled))
          return
        }

        if (msgType === 'runSetup') {
          await this.#runSetup()
          return
        }

        if (msgType === 'clearErrors') {
          this.#clearErrors()
          return
        }
      } catch (error) {
        const errorMessage = error?.message || String(error)
        this.output.appendLine(`[error] ${errorMessage}`)
        vscode.window.showErrorMessage(`Conversation Composer: ${errorMessage}`)
        this.#post({ type: 'error', message: errorMessage })
      }
    })

    this.#refreshState().catch((error) => {
      this.output.appendLine(`[warning] initial state refresh failed: ${error?.message || error}`)
    })
  }

  async initializeWorkspaceFromCommand() {
    await this.#initializeWorkspaceAndReload()
  }

  async connectFromCommand() {
    this.output.appendLine('[composer][action] connect command invoked')
    await this.composerClient.connect()
    vscode.window.showInformationMessage('Conversation Composer connected to runtime.')
  }

  async disconnectFromCommand() {
    this.output.appendLine('[composer][action] disconnect command invoked')
    await this.composerClient.disconnect()
    vscode.window.showInformationMessage('Conversation Composer disconnected.')
  }

  async sendFromCommand() {
    const text = await vscode.window.showInputBox({
      prompt: 'Send message to Conversation Composer runtime',
      placeHolder: 'Ask the assistant...',
      ignoreFocusOut: true,
    })

    if (!text) {
      return
    }

    await this.#sendMessage(text)
  }

  async #initializeWorkspaceAndReload() {
    const sessionRoot = this.#requireSessionRoot()
    const models = this.getModelOptions()
    await initializeWorkspace(sessionRoot, models)
    this.state.workspaceReady = true
    await this.#refreshState()
    vscode.window.showInformationMessage('Conversation Composer initialized for this folder.')
  }

  async #refreshState() {
    const sessionRoot = this.#requireSessionRoot()
    this.state.models = this.getModelOptions()

    try {
      this.state.config = await loadConfig(sessionRoot)
      this.state.workspaceReady = true
    } catch {
      this.state.workspaceReady = false
      this.state.config = null
      this.state.conversation = []
      this.state.availableTools = []
      this.#postState()
      return
    }

    this.state.conversation = await loadConversation(sessionRoot, this.state.config.conversation)

    if (this.state.connected) {
      try {
        const snapshotResponse = await this.composerClient.refreshSnapshot()
        const toolNames = snapshotResponse?.data?.availableTools
        this.state.availableTools = Array.isArray(toolNames)
          ? toolNames.map((entry) => String(entry || '')).filter(Boolean)
          : []
      } catch {
        this.state.availableTools = []
      }
    } else {
      this.state.availableTools = []
    }

    this.#postState()
  }

  async #sendMessage(text) {
    const trimmed = String(text || '').trim()
    if (!trimmed) {
      return
    }

    if (!this.state.workspaceReady || !this.state.config) {
      throw new Error('Initialize Composer before sending messages.')
    }

    const message = {
      role: 'user',
      content: trimmed,
      timestamp: nowIso(),
    }

    this.state.conversation.push(message)
    await this.#appendConversation([message])
    this.#postState()

    this.output.appendLine(`[composer][send] enqueue user_message chars=${trimmed.length}`)
    const startedAt = Date.now()
    await this.composerClient.sendUserMessage(trimmed)
    this.output.appendLine(`[composer][send] enqueue acknowledged elapsedMs=${Date.now() - startedAt}`)
  }

  async #clearConversation() {
    const sessionRoot = this.#requireSessionRoot()
    if (!this.state.config) {
      return
    }
    await clearConversation(sessionRoot, this.state.config.conversation)
    this.state.conversation = []
    this.#postState()
  }

  async #addSystemFileFromPicker() {
    const workspaceFolder = getWorkspaceFolder()
    const sessionRoot = this.#requireSessionRoot()
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      defaultUri: vscode.Uri.file(path.join(workspaceFolder, 'system')),
      filters: {
        Markdown: ['md', 'markdown'],
      },
    })
    if (!selected || selected.length === 0) {
      return
    }

    this.state.config = await addSystemFile(sessionRoot, selected[0].fsPath)
    await generateWorkflow(sessionRoot, this.state.config)
    this.#postState()
  }

  async #removeSystemFile(relPath) {
    if (!relPath) {
      return
    }
    const sessionRoot = this.#requireSessionRoot()
    this.state.config = await removeSystemFile(sessionRoot, relPath)
    await generateWorkflow(sessionRoot, this.state.config)
    this.#postState()
  }

  async #moveSystemFile(items) {
    const sessionRoot = this.#requireSessionRoot()
    this.state.config = await reorderSystemFiles(sessionRoot, items)
    await generateWorkflow(sessionRoot, this.state.config)
    this.#postState()
  }

  async #setModel(model) {
    if (!this.state.config) {
      return
    }
    const sessionRoot = this.#requireSessionRoot()
    this.state.config.model = model
    this.state.config = await saveConfig(sessionRoot, this.state.config)
    await generateWorkflow(sessionRoot, this.state.config)
    this.#postState()
  }

  async #toggleTool(toolName, enabled) {
    if (!this.state.config || !toolName) {
      return
    }

    const sessionRoot = this.#requireSessionRoot()
    const enabledSet = new Set(this.state.config.tools.enabled)
    const disabledSet = new Set(this.state.config.tools.disabled)

    if (enabled) {
      enabledSet.add(toolName)
      disabledSet.delete(toolName)
    } else {
      enabledSet.delete(toolName)
      disabledSet.add(toolName)
    }

    this.state.config.tools.enabled = [...enabledSet]
    this.state.config.tools.disabled = [...disabledSet]
    this.state.config = await saveConfig(sessionRoot, this.state.config)
    await generateWorkflow(sessionRoot, this.state.config)
    this.#postState()
  }

  async #runSetup() {
    vscode.window.showWarningMessage('Composer setup is disabled in non-invasive mode.')
  }

  #clearErrors() {
    this.state.runtimeErrors = []
    this.state.lastError = null
    this.#postState()
  }

  async #appendConversation(messages) {
    const sessionRoot = this.#requireSessionRoot()
    if (!this.state.config) {
      return
    }
    await appendConversationMessages(sessionRoot, this.state.config.conversation, messages)
  }

  #requireSessionRoot() {
    const sessionRoot = String(this.getSessionRoot?.() || '').trim()
    if (!sessionRoot) {
      throw new Error('Open a workspace folder before using Conversation Composer.')
    }
    return sessionRoot
  }

  #postState() {
    this.#post({
      type: 'state',
      state: {
        workspaceReady: this.state.workspaceReady,
        config: this.state.config,
        conversation: this.state.conversation,
        availableTools: this.state.availableTools,
        models: this.state.models,
        connected: this.state.connected,
        connecting: this.state.connecting,
        runtimeErrors: this.state.runtimeErrors,
        lastError: this.state.lastError,
      },
    })
  }

  #post(message) {
    if (!this.view) {
      return
    }
    this.view.webview.postMessage(message)
  }

  #buildHtml(webview) {
    const nonce = getNonce()
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'index.html')
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'main.js'))
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'src', 'webview', 'styles.css'))

    const html = require('node:fs').readFileSync(htmlPath.fsPath, 'utf8')
    return html
      .replaceAll('__NONCE__', nonce)
      .replaceAll('__SCRIPT_URI__', String(scriptUri))
      .replaceAll('__STYLE_URI__', String(styleUri))
  }
}

module.exports = {
  ComposerViewProvider,
}
