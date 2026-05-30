const status = document.getElementById('status')
const interactions = document.getElementById('interactions')
const startedAt = new Date().toISOString()
let surfaceSocket = null
let reconnectTimer = null

if (status) {
  status.textContent = `running (${startedAt})`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderEmptyState() {
  if (!interactions) return
  interactions.innerHTML = `
    <div class="interaction-empty">
      <h2>No active interactions</h2>
      <p>Send <code>open choice</code> through the runtime and the realized semantic intent will appear here.</p>
    </div>
  `
}

function renderInteractions(items, updatedAt) {
  if (!interactions) return
  if (!Array.isArray(items) || items.length === 0) {
    renderEmptyState()
    return
  }

  interactions.innerHTML = items.map((entry) => {
    const value = entry?.value ?? {}
    const intent = value?.intent ?? {}
    const options = Array.isArray(intent.options) ? intent.options : []
    const optionsHtml = options.map((option) => {
      return `<li><button type="button" data-semantic-surface-option-id="${escapeHtml(option?.id ?? '')}">${escapeHtml(option?.label ?? option?.id ?? 'option')}</button></li>`
    }).join('')

    return `
      <article class="interaction-card" data-semantic-surface-interaction-id="${escapeHtml(entry?.interactionId ?? '')}" data-semantic-surface-target="${escapeHtml(entry?.target ?? '')}">
        <div class="interaction-meta">target ${escapeHtml(entry?.target)} · id ${escapeHtml(entry?.interactionId)}</div>
        <h2>${escapeHtml(intent?.text ?? 'Semantic interaction')}</h2>
        <p class="interaction-kind">intent: ${escapeHtml(intent?.type ?? 'unknown')}</p>
        <ul class="interaction-options">${optionsHtml}</ul>
        <p class="interaction-timestamp">rendered ${escapeHtml(entry?.renderedAt ?? updatedAt ?? '')}</p>
      </article>
    `
  }).join('')
}

function getSurfaceWsUrl() {
  const surfaceUrl = new URL(window.location.href)
  surfaceUrl.protocol = surfaceUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  surfaceUrl.pathname = '/api/semantic-surface/ws'
  surfaceUrl.search = ''
  surfaceUrl.hash = ''
  return surfaceUrl.toString()
}

function setStatus(text) {
  if (!status) return
  status.textContent = text
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connectSurfaceSocket()
  }, 1000)
}

function sendSemanticSelection(interactionId, target, optionId) {
  if (!surfaceSocket || surfaceSocket.readyState !== WebSocket.OPEN) {
    setStatus('semantic surface disconnected')
    return
  }

  const timestamp = new Date().toISOString()
  const value = {
    selected: optionId,
  }

  surfaceSocket.send(JSON.stringify({
    type: 'semantic_surface_event',
    payload: {
      interactionId,
      target,
      action: 'selected',
      eventType: 'semantic_surface_event',
      schemaVersion: '1.0',
      sourceSessionId: 'semantic-surface-browser',
      timestamp,
      value,
      payload: value,
    },
  }))
  setStatus(`sent ${optionId}`)
}

function handleInteractionsClick(event) {
  const targetElement = event.target instanceof Element ? event.target : null
  const button = targetElement ? targetElement.closest('button[data-semantic-surface-option-id]') : null
  if (!button || !interactions || !interactions.contains(button)) return

  const card = button.closest('[data-semantic-surface-interaction-id]')
  const interactionId = String(card?.dataset.semanticSurfaceInteractionId ?? '').trim()
  const target = String(card?.dataset.semanticSurfaceTarget ?? '').trim()
  const optionId = String(button.dataset.semanticSurfaceOptionId ?? '').trim()
  if (!interactionId || !target || !optionId) return

  sendSemanticSelection(interactionId, target, optionId)
}

function connectSurfaceSocket() {
  try {
    setStatus('connecting semantic surface...')
    surfaceSocket = new WebSocket(getSurfaceWsUrl())

    surfaceSocket.addEventListener('open', () => {
      setStatus('semantic surface connected')
    })

    surfaceSocket.addEventListener('message', (event) => {
      let message
      try {
        message = JSON.parse(String(event.data ?? '{}'))
      } catch {
        return
      }

      if (message?.type === 'error') {
        const text = String(message?.message ?? 'unknown semantic ingress error')
        setStatus(`semantic ingress failed (${text})`)
        return
      }

      if (message?.type !== 'snapshot') return
      const snapshot = message?.snapshot ?? {}
      renderInteractions(snapshot.interactions ?? [], snapshot.updatedAt ?? '')
    })

    surfaceSocket.addEventListener('close', () => {
      surfaceSocket = null
      setStatus('semantic surface disconnected')
      scheduleReconnect()
    })

    surfaceSocket.addEventListener('error', () => {
      setStatus('semantic surface connection error')
      scheduleReconnect()
    })
  } catch (error) {
    setStatus(`surface connection unavailable (${String(error?.message ?? error)})`)
    scheduleReconnect()
  }
}

renderEmptyState()
if (interactions) {
  interactions.addEventListener('click', handleInteractionsClick)
}
connectSurfaceSocket()
