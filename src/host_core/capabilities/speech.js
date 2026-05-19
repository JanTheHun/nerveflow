/**
 * speechCapability creates a speech capability that provides
 * ingress connectors for speech-to-text (STT) and effect realizers for text-to-speech (TTS).
 *
 * Configuration:
 *   stt: Optional speech-to-text connector factory (uses createWhisperIngressConnector by default)
 *   tts: Optional text-to-speech realizer factory (uses createPiperEffectRealizer by default)
 *   whisperModel: Whisper model name for STT (default: 'whisper-small')
 *   piperVoice: Piper voice for TTS (default: 'en_US-libritts-high')
 *   piperLanguage: Piper language for TTS (default: 'en_US')
 *
 * Usage:
 *   host.attachCapability(speechCapability({ whisperModel: 'whisper-base' }))
 */

import {
  createWhisperIngressConnector,
  createPiperEffectRealizer,
} from '../../host_modules/public/index.js'

export function speechCapability({
  stt,
  tts,
  whisperModel = 'whisper-small',
  piperVoice = 'en_US-libritts-high',
  piperLanguage = 'en_US',
} = {}) {
  const ingressConnectors = []
  const effectRealizers = []

  // If no custom stt provided, use default Whisper connector
  if (!stt) {
    stt = createWhisperIngressConnector({
      model: whisperModel,
    })
  }
  if (stt) {
    ingressConnectors.push(stt)
  }

  // If no custom tts provided, use default Piper realizer
  if (!tts) {
    tts = createPiperEffectRealizer({
      voice: piperVoice,
      language: piperLanguage,
    })
  }
  if (tts) {
    effectRealizers.push(tts)
  }

  return {
    ingressConnectors,
    effectRealizers,
  }
}
