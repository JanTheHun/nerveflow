import test from 'node:test'
import assert from 'node:assert/strict'

function createClassList() {
  const classes = new Set()
  return {
    add: (...values) => {
      for (const value of values) classes.add(String(value))
    },
    remove: (...values) => {
      for (const value of values) classes.delete(String(value))
    },
    toggle: (value, force) => {
      const token = String(value)
      if (force === true) {
        classes.add(token)
        return true
      }
      if (force === false) {
        classes.delete(token)
        return false
      }
      if (classes.has(token)) {
        classes.delete(token)
        return false
      }
      classes.add(token)
      return true
    },
    contains: (value) => classes.has(String(value)),
    toString: () => [...classes].join(' '),
  }
}

function createNode(tagName = '') {
  return {
    tagName: String(tagName).toUpperCase(),
    children: [],
    dataset: {},
    style: {
      setProperty() {},
      removeProperty() {},
    },
    classList: createClassList(),
    className: '',
    textContent: '',
    title: '',
    hidden: false,
    value: '',
    checked: false,
    disabled: false,
    options: [],
    innerHTML: '',
    appendChild(child) {
      this.children.push(child)
      return child
    },
    addEventListener() {},
    removeEventListener() {},
    setAttribute(name, value) {
      this[name] = String(value)
    },
    getAttribute(name) {
      return this[name]
    },
    removeAttribute(name) {
      delete this[name]
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    focus() {},
    dispatchEvent() {},
  }
}

function installDomStub() {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
  }

  const nodesById = new Map()
  const documentStub = {
    body: createNode('body'),
    addEventListener() {},
    removeEventListener() {},
    createElement: (tagName) => createNode(tagName),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
    createDocumentFragment: () => createNode('#fragment'),
    getElementById: (id) => {
      const key = String(id)
      if (!nodesById.has(key)) {
        nodesById.set(key, createNode('div'))
      }
      return nodesById.get(key)
    },
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
    caretPositionFromPoint() {
      return null
    },
    caretRangeFromPoint() {
      return null
    },
  }

  const localStorageStub = {
    store: new Map(),
    getItem(key) {
      return this.store.has(String(key)) ? this.store.get(String(key)) : null
    },
    setItem(key, value) {
      this.store.set(String(key), String(value))
    },
    removeItem(key) {
      this.store.delete(String(key))
    },
    clear() {
      this.store.clear()
    },
  }

  globalThis.document = documentStub
  globalThis.window = { document: documentStub, addEventListener() {}, removeEventListener() {} }
  globalThis.localStorage = localStorageStub

  return () => {
    globalThis.document = previous.document
    globalThis.window = previous.window
    globalThis.localStorage = previous.localStorage
  }
}

test('console model call token carries callId for inspector handoff', async () => {
  const restore = installDomStub()
  try {
    const { buildExecutionEventContentFragment } = await import('../nerve-studio/public/src-app/02_user_output.js')

    const fragment = buildExecutionEventContentFragment({
      type: 'agent_call',
      agent: 'model:llama3.2:latest',
      callId: 'call-123',
    })

    assert.equal(fragment.children.length >= 2, true)
    const token = fragment.children.find((child) => child?.className === 'exec-event-token')
    assert.equal(Boolean(token), true)
    assert.equal(token.dataset.nerveTokenKind, 'agent')
    assert.equal(token.dataset.nerveTokenValue, 'model:llama3.2:latest')
    assert.equal(token.dataset.nerveTokenCallId, 'call-123')
  } finally {
    restore()
  }
})
