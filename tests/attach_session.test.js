import test from 'node:test'
import assert from 'node:assert/strict'

import { createAttachSession, validateAttachWsUrlOrThrow } from '../nerve-studio/attach-session.js'

test('validateAttachWsUrlOrThrow rejects missing and non-ws urls', () => {
  assert.throws(() => validateAttachWsUrlOrThrow(''), /attach mode requires attachWsUrl/i)
  assert.throws(() => validateAttachWsUrlOrThrow('http://127.0.0.1:8300/api/runtime/ws'), /must use ws:\/\/ or wss:\/\//i)
})

test('attach session reuses the same bridge for the same url and replaces on url change', () => {
  const created = []
  const disconnected = []
  const attachSession = createAttachSession({
    createBridge: (wsUrl) => {
      created.push(wsUrl)
      return {
        wsUrl,
        disconnect() {
          disconnected.push(wsUrl)
        },
      }
    },
  })

  const firstUrl = new URL('http://localhost/?attachWsUrl=ws://127.0.0.1:8300/api/runtime/ws')
  const secondUrl = new URL('http://localhost/?attachWsUrl=ws://127.0.0.1:8400/api/runtime/ws')

  const firstBridge = attachSession.getBridge(firstUrl, { required: true })
  const reusedBridge = attachSession.getBridge(firstUrl, { required: true })
  const secondBridge = attachSession.getBridge(secondUrl, { required: true })

  assert.equal(firstBridge, reusedBridge)
  assert.notEqual(firstBridge, secondBridge)
  assert.deepEqual(created, [
    'ws://127.0.0.1:8300/api/runtime/ws',
    'ws://127.0.0.1:8400/api/runtime/ws',
  ])
  assert.deepEqual(disconnected, ['ws://127.0.0.1:8300/api/runtime/ws'])

  attachSession.disconnect()
  assert.deepEqual(disconnected, [
    'ws://127.0.0.1:8300/api/runtime/ws',
    'ws://127.0.0.1:8400/api/runtime/ws',
  ])
})

test('attach session honors default url and optional bridge resolution', () => {
  const attachSession = createAttachSession({
    defaultWsUrl: 'ws://127.0.0.1:8500/api/runtime/ws',
    createBridge: (wsUrl) => ({
      wsUrl,
      disconnect() {},
    }),
  })

  const bridgeFromDefault = attachSession.getBridge(new URL('http://localhost/'), { required: true })
  const missingOptional = createAttachSession({
    createBridge: (wsUrl) => ({ wsUrl, disconnect() {} }),
  }).getBridge(new URL('http://localhost/'))

  assert.equal(bridgeFromDefault.wsUrl, 'ws://127.0.0.1:8500/api/runtime/ws')
  assert.equal(missingOptional, null)
})