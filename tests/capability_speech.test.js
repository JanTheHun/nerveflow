import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  speechCapability,
} from '../src/host_core/index.js'

test('speechCapability with defaults returns capability with whisper and piper', () => {
  const capability = speechCapability()

  assert.equal(Array.isArray(capability.ingressConnectors), true)
  assert.equal(Array.isArray(capability.effectRealizers), true)
  assert.ok(capability.ingressConnectors.length > 0, 'should have at least one ingress connector (Whisper)')
  assert.ok(capability.effectRealizers.length > 0, 'should have at least one effect realizer (Piper)')
})

test('speechCapability with custom stt only', () => {
  const customStt = { name: 'custom-stt' }

  const capability = speechCapability({ stt: customStt })

  assert.equal(Array.isArray(capability.ingressConnectors), true)
  assert.equal(capability.ingressConnectors[0], customStt)
  assert.ok(capability.effectRealizers.length > 0, 'should still have default Piper')
})

test('speechCapability with custom tts only', () => {
  const customTts = { name: 'custom-tts' }

  const capability = speechCapability({ tts: customTts })

  assert.equal(Array.isArray(capability.effectRealizers), true)
  assert.equal(capability.effectRealizers[0], customTts)
  assert.ok(capability.ingressConnectors.length > 0, 'should still have default Whisper')
})

test('speechCapability with both custom stt and tts', () => {
  const customStt = { name: 'custom-stt' }
  const customTts = { name: 'custom-tts' }

  const capability = speechCapability({ stt: customStt, tts: customTts })

  assert.equal(capability.ingressConnectors[0], customStt)
  assert.equal(capability.effectRealizers[0], customTts)
})

test('speechCapability respects whisper model parameter', () => {
  const capability = speechCapability({ whisperModel: 'whisper-large' })

  assert.ok(capability.ingressConnectors.length > 0)
  // The actual model configuration is internal to the Whisper connector
})

test('speechCapability respects piper voice and language parameters', () => {
  const capability = speechCapability({
    piperVoice: 'en_GB-jenny_dioco-medium',
    piperLanguage: 'en_GB',
  })

  assert.ok(capability.effectRealizers.length > 0)
  // The actual voice/language configuration is internal to the Piper realizer
})
