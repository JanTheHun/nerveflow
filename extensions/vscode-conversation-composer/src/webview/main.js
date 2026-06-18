const vscode = acquireVsCodeApi()

const state = {
  workspaceReady: false,
  config: null,
  conversation: [],
  availableTools: [],
  models: [],
  connected: false,
  connecting: false,
  runtimeErrors: [],
  lastError: null,
}

const statusEl = document.getElementById('status')
const modelSelectEl = document.getElementById('modelSelect')
const systemListEl = document.getElementById('systemList')
const toolListEl = document.getElementById('toolList')
const errorLogEl = document.getElementById('errorLog')
const conversationEl = document.getElementById('conversation')
const messageInputEl = document.getElementById('messageInput')

function post(type, payload = {}) {
  vscode.postMessage({ type, ...payload })
}

function htmlEscape(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderStatus() {
  if (state.connecting) {
    statusEl.textContent = 'Connecting...'
    return
  }
  statusEl.textContent = state.connected ? 'Connected' : 'Disconnected'
}

function renderModels() {
  const models = state.models || []
  modelSelectEl.innerHTML = models.map((model) => {
    const selected = state.config?.model === model ? 'selected' : ''
    return `<option value="${htmlEscape(model)}" ${selected}>${htmlEscape(model)}</option>`
  }).join('')
}

function renderSystemList() {
  const systemPaths = state.config?.system || []
  if (systemPaths.length === 0) {
    systemListEl.innerHTML = '<li class="empty">No system markdown files.</li>'
    return
  }

  systemListEl.innerHTML = systemPaths.map((entry, index) => {
    const disableUp = index === 0 ? 'disabled' : ''
    const disableDown = index === systemPaths.length - 1 ? 'disabled' : ''
    return `<li>
      <span>${htmlEscape(entry)}</span>
      <span>
        <button class="secondary" data-move-up="${htmlEscape(entry)}" ${disableUp}>Up</button>
        <button class="secondary" data-move-down="${htmlEscape(entry)}" ${disableDown}>Down</button>
      </span>
      <button class="danger" data-remove-system="${htmlEscape(entry)}">Remove</button>
    </li>`
  }).join('')

  systemListEl.querySelectorAll('[data-move-up]').forEach((button) => {
    button.addEventListener('click', () => {
      const relPath = button.getAttribute('data-move-up') || ''
      const current = [...systemPaths]
      const idx = current.indexOf(relPath)
      if (idx <= 0) {
        return
      }
      const swap = current[idx - 1]
      current[idx - 1] = current[idx]
      current[idx] = swap
      post('moveSystemFile', { items: current })
    })
  })

  systemListEl.querySelectorAll('[data-move-down]').forEach((button) => {
    button.addEventListener('click', () => {
      const relPath = button.getAttribute('data-move-down') || ''
      const current = [...systemPaths]
      const idx = current.indexOf(relPath)
      if (idx < 0 || idx >= current.length - 1) {
        return
      }
      const swap = current[idx + 1]
      current[idx + 1] = current[idx]
      current[idx] = swap
      post('moveSystemFile', { items: current })
    })
  })

  systemListEl.querySelectorAll('[data-remove-system]').forEach((button) => {
    button.addEventListener('click', () => {
      const relPath = button.getAttribute('data-remove-system') || ''
      post('removeSystemFile', { path: relPath })
    })
  })
}

function renderTools() {
  const enabled = new Set(state.config?.tools?.enabled || [])
  const disabled = new Set(state.config?.tools?.disabled || [])
  const runtimeTools = Array.isArray(state.availableTools) ? state.availableTools : []
  const combined = new Set([...runtimeTools, ...enabled, ...disabled])
  const sorted = [...combined].sort((a, b) => a.localeCompare(b))

  if (sorted.length === 0) {
    toolListEl.innerHTML = '<li class="empty">No tools configured.</li>'
    return
  }

  toolListEl.innerHTML = sorted.map((tool) => {
    const isChecked = enabled.has(tool)
    return `<li>
      <label>
        <input type="checkbox" data-tool="${htmlEscape(tool)}" ${isChecked ? 'checked' : ''} />
        ${htmlEscape(tool)}
      </label>
    </li>`
  }).join('')

  toolListEl.querySelectorAll('input[data-tool]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const tool = checkbox.getAttribute('data-tool') || ''
      post('toggleTool', { tool, enabled: checkbox.checked })
    })
  })
}

function renderConversation() {
  const messages = state.conversation || []
  if (messages.length === 0) {
    conversationEl.innerHTML = '<div class="empty">No messages yet.</div>'
    return
  }

  conversationEl.innerHTML = messages.map((message) => {
    const role = htmlEscape(message.role)
    const content = htmlEscape(message.content)
    return `<div class="message ${role}">
      <div class="role">${role}</div>
      <div class="content">${content}</div>
    </div>`
  }).join('')
  conversationEl.scrollTop = conversationEl.scrollHeight
}

function renderErrorLog() {
  const errors = Array.isArray(state.runtimeErrors) ? state.runtimeErrors : []
  if (errors.length === 0) {
    errorLogEl.innerHTML = '<div class="empty">No runtime errors.</div>'
    return
  }

  errorLogEl.innerHTML = errors.map((entry) => {
    const code = htmlEscape(entry?.code || 'NEXTV_ERROR')
    const message = htmlEscape(entry?.message || 'Runtime execution failed.')
    const hasLocation = Boolean(entry?.sourcePath)
    const sourceLine = Number.isFinite(Number(entry?.sourceLine)) ? Number(entry.sourceLine) : '?'
    const location = hasLocation
      ? `${htmlEscape(entry.sourcePath)}:${htmlEscape(sourceLine)}`
      : 'No source location'
    const statement = entry?.statement
      ? `<div class="errorStatement">${htmlEscape(entry.statement)}</div>`
      : ''
    const guidance = entry?.guidance
      ? `<div class="errorGuidance">${htmlEscape(entry.guidance)}</div>`
      : ''
    return `<div class="errorEntry">
      <div class="errorCode">${code}</div>
      <div class="errorMessage">${message}</div>
      <div class="errorLocation">${location}</div>
      ${statement}
      ${guidance}
    </div>`
  }).join('')

  errorLogEl.scrollTop = errorLogEl.scrollHeight
}

function renderAll() {
  renderStatus()
  renderModels()
  renderSystemList()
  renderTools()
  renderErrorLog()
  renderConversation()
}

modelSelectEl.addEventListener('change', () => {
  post('setModel', { model: modelSelectEl.value })
})

document.getElementById('initializeWorkspace').addEventListener('click', () => {
  post('initializeWorkspace')
})

document.getElementById('connectRuntime').addEventListener('click', () => {
  post('connectRuntime')
})

document.getElementById('disconnectRuntime').addEventListener('click', () => {
  post('disconnectRuntime')
})

document.getElementById('sendMessage').addEventListener('click', () => {
  const text = messageInputEl.value.trim()
  if (!text) {
    return
  }
  post('sendMessage', { text })
  messageInputEl.value = ''
})

document.getElementById('addSystemFile').addEventListener('click', () => {
  post('addSystemFile')
})

document.getElementById('clearConversation').addEventListener('click', () => {
  post('clearConversation')
})

document.getElementById('clearErrors').addEventListener('click', () => {
  post('clearErrors')
})

window.addEventListener('message', (event) => {
  const message = event.data || {}

  if (message.type === 'state') {
    const next = message.state || {}
    state.workspaceReady = Boolean(next.workspaceReady)
    state.config = next.config || null
    state.conversation = Array.isArray(next.conversation) ? next.conversation : []
    state.availableTools = Array.isArray(next.availableTools) ? next.availableTools : []
    state.models = Array.isArray(next.models) ? next.models : []
    state.connected = Boolean(next.connected)
    state.connecting = Boolean(next.connecting)
    state.runtimeErrors = Array.isArray(next.runtimeErrors) ? next.runtimeErrors : []
    state.lastError = next.lastError || null
    renderAll()
    return
  }

  if (message.type === 'error') {
    const text = message.message || 'Unknown error.'
    alert(text)
    return
  }

  if (message.type === 'setupResult') {
    const modelAlias = message?.result?.modelAlias || 'configured model'
    alert(`Setup complete for ${modelAlias}.`)
  }
})

post('refreshState')
