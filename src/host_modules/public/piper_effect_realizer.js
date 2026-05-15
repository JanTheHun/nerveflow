import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildPiperLaunchConfig,
  executeSpeechProcess,
  extractOutputText,
} from './speech_process.js'

export function createPiperEffectRealizer(options = {}) {
  const effectName = String(options.effectName ?? process.env.VOICE_EFFECT_NAME ?? 'voice').trim() || 'voice'
  const cwd = String(options.cwd ?? process.cwd())
  const env = {
    ...process.env,
    ...(options.env || {}),
  }

  return {
    [effectName]: async (payload = {}) => {
      const text = extractOutputText(payload)
      if (!text) {
        return { skipped: true, reason: 'empty_output_text' }
      }

      const outputPath = join(tmpdir(), `nerveflow-piper-${randomUUID()}.wav`)
      try {
        const launchConfig = buildPiperLaunchConfig(env, outputPath)
        const result = await executeSpeechProcess({
          command: launchConfig.command,
          args: launchConfig.args,
          cwd,
          stdinText: text,
        })

        if (result.code !== 0) {
          const details = String(result.stderr || result.stdout || '').trim()
          throw new Error(`Piper runner exited with status ${result.code}${details ? `: ${details}` : ''}`)
        }

        if (!existsSync(outputPath)) {
          throw new Error(`Piper output file not found at ${outputPath}`)
        }

        const audioBuffer = readFileSync(outputPath)
        return {
          text,
          audioBase64: audioBuffer.toString('base64'),
          mimeType: 'audio/wav',
        }
      } finally {
        rmSync(outputPath, { force: true })
      }
    },
  }
}
