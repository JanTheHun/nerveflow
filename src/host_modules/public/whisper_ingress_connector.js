import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildWhisperLaunchConfig,
  executeSpeechProcess,
  extractTranscript,
  pickAudioExtension,
} from './speech_process.js'

async function transcribeAudioFromPath(inputPath, { env, cwd }) {
  const outputPath = inputPath.replace(/\.[^.]+$/, '')
  const launchConfig = buildWhisperLaunchConfig(env, inputPath, outputPath)
  const result = await executeSpeechProcess({
    command: launchConfig.command,
    args: launchConfig.args,
    cwd,
  })

  if (result.code !== 0) {
    const details = String(result.stderr || result.stdout || '').trim()
    throw new Error(`Whisper runner exited with status ${result.code}${details ? `: ${details}` : ''}`)
  }

  const jsonPath = `${outputPath}.json`
  if (!existsSync(jsonPath)) {
    throw new Error(`Whisper JSON output file not found at ${jsonPath}`)
  }

  const transcript = extractTranscript(readFileSync(jsonPath, 'utf8'))
  if (!transcript) {
    throw new Error('Whisper transcript was empty')
  }

  return transcript
}

function normalizeTranscriptInput(input) {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed) return { transcript: trimmed }
    return {}
  }

  if (!input || typeof input !== 'object') return {}

  const transcript = String(input.transcript ?? input.text ?? '').trim()
  if (transcript) return { transcript }

  const audioPath = String(input.audioPath ?? '').trim()
  const audioBase64 = String(input.audioBase64 ?? '').trim()
  const contentType = String(input.contentType ?? 'audio/webm').trim() || 'audio/webm'

  return {
    audioPath,
    audioBase64,
    contentType,
  }
}

export function createWhisperIngressConnector(options = {}) {
  const ingressName = String(options.ingressName ?? process.env.VOICE_INGRESS_NAME ?? 'voice_audio').trim() || 'voice_audio'
  const eventType = String(options.eventType ?? process.env.VOICE_EVENT_TYPE ?? 'user_message').trim() || 'user_message'
  const cwd = String(options.cwd ?? process.cwd())
  const env = {
    ...process.env,
    ...(options.env || {}),
  }

  return {
    [ingressName]: async (payload = {}) => {
      const normalized = normalizeTranscriptInput(payload?.value ?? payload)

      if (normalized.transcript) {
        return [{ type: eventType, value: normalized.transcript }]
      }

      if (normalized.audioPath) {
        const transcript = await transcribeAudioFromPath(normalized.audioPath, { env, cwd })
        return [{ type: eventType, value: transcript }]
      }

      if (normalized.audioBase64) {
        const extension = pickAudioExtension(normalized.contentType)
        const tempInputPath = join(tmpdir(), `nerveflow-whisper-${randomUUID()}${extension}`)
        try {
          const audioBuffer = Buffer.from(normalized.audioBase64, 'base64')
          if (audioBuffer.length === 0) {
            throw new Error('audioBase64 payload decoded to empty buffer')
          }

          writeFileSync(tempInputPath, audioBuffer)
          const transcript = await transcribeAudioFromPath(tempInputPath, { env, cwd })
          return [{ type: eventType, value: transcript }]
        } finally {
          rmSync(tempInputPath, { force: true })
          rmSync(tempInputPath.replace(/\.[^.]+$/, '.json'), { force: true })
        }
      }

      throw new Error(`${ingressName} ingress requires transcript text, audioPath, or audioBase64 payload`)
    },
  }
}
