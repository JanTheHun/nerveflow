import { extname } from 'node:path'

export function parseDotEnv(content = '') {
  const result = {}
  const lines = String(content ?? '').split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex <= 0) continue

    const key = trimmed.slice(0, eqIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue

    let value = trimmed.slice(eqIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }

  return result
}

export function splitCommandArgs(value = '') {
  const input = String(value ?? '')
  const parts = []
  let current = ''
  let quote = ''

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (char === '\\' && index + 1 < input.length) {
      const next = input[index + 1]
      if (next === '"' || next === "'" || next === '\\') {
        current += next
        index += 1
        continue
      }
    }

    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        parts.push(current)
        current = ''
      }
      continue
    }

    current += char
  }

  if (current) parts.push(current)
  return parts
}

function quoteCmdArgument(value) {
  const raw = String(value ?? '')
  if (!raw) return '""'
  if (!/[\s"]/u.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

export function pickAudioExtension(contentType = '') {
  const normalized = String(contentType ?? '').toLowerCase()
  if (normalized.includes('wav')) return '.wav'
  if (normalized.includes('ogg')) return '.ogg'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return '.mp3'
  if (normalized.includes('mp4') || normalized.includes('m4a')) return '.m4a'
  return '.webm'
}

export function buildWhisperLaunchConfig(env, inputPath, outputPath = '') {
  const whisperRunPath = String(env?.WHISPER_RUN_PATH ?? '').trim()
  if (!whisperRunPath) {
    throw new Error('WHISPER_RUN_PATH is required in voice-spa/.env')
  }

  const argsTemplate = splitCommandArgs(env?.WHISPER_RUN_ARGS ?? '')
  const hasInputPlaceholder = argsTemplate.some((part) => part.includes('{input}'))
  const resolvedArgs = argsTemplate.map((part) => {
    let resolved = part.replaceAll('{input}', inputPath)
    if (outputPath) resolved = resolved.replaceAll('{output}', outputPath)
    resolved = resolved.replaceAll('{model}', env?.WHISPER_MODEL ?? '')
    return resolved
  })
  if (!hasInputPlaceholder) {
    resolvedArgs.push(inputPath)
  }

  const extension = extname(whisperRunPath).toLowerCase()
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return {
      command: process.execPath,
      args: [whisperRunPath, ...resolvedArgs],
    }
  }

  if (extension === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', whisperRunPath, ...resolvedArgs],
    }
  }

  if (extension === '.cmd' || extension === '.bat') {
    const commandString = [quoteCmdArgument(whisperRunPath), ...resolvedArgs.map(quoteCmdArgument)].join(' ')
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', commandString],
    }
  }

  return {
    command: whisperRunPath,
    args: resolvedArgs,
  }
}

export function buildPiperLaunchConfig(env, outputPath) {
  const piperRunPath = String(env?.PIPER_RUN_PATH ?? '').trim()
  if (!piperRunPath) {
    throw new Error('PIPER_RUN_PATH is required in voice-spa/.env')
  }

  const defaultArgs = '--model "{model}" --output_file "{output}"'
  const argsTemplate = splitCommandArgs(env?.PIPER_RUN_ARGS ?? defaultArgs)
  const resolvedArgs = argsTemplate.map((part) =>
    part.replaceAll('{output}', outputPath).replaceAll('{model}', env?.PIPER_MODEL ?? '')
  )

  const extension = extname(piperRunPath).toLowerCase()
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return { command: process.execPath, args: [piperRunPath, ...resolvedArgs] }
  }
  if (extension === '.ps1') {
    return { command: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', piperRunPath, ...resolvedArgs] }
  }
  if (extension === '.cmd' || extension === '.bat') {
    const commandString = [quoteCmdArgument(piperRunPath), ...resolvedArgs.map(quoteCmdArgument)].join(' ')
    return { command: 'cmd.exe', args: ['/d', '/s', '/c', commandString] }
  }
  return { command: piperRunPath, args: resolvedArgs }
}

export function extractOutputText(effectPayload) {
  const runtimeEvent = effectPayload?.runtimeEvent
  const value = runtimeEvent?.value ?? runtimeEvent?.content ?? runtimeEvent?.payload
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).trim()
}

export function extractTranscript(jsonObj = null) {
  if (jsonObj === null || jsonObj === undefined) return ''

  const parsed = typeof jsonObj === 'string' ? JSON.parse(jsonObj) : jsonObj

  if (typeof parsed === 'string' && parsed.trim()) return parsed.trim()

  if (parsed && typeof parsed === 'object') {
    // whisper.cpp -oj format: transcription is an array of segments
    if (Array.isArray(parsed.transcription) && parsed.transcription.length > 0) {
      const text = parsed.transcription.map((seg) => String(seg?.text ?? '')).join(' ').trim()
      if (text) return text
    }

    // Try common single-field names (other whisper implementations)
    const candidates = [
      parsed.text,
      parsed.transcript,
      parsed.result?.text,
      parsed.data?.text,
      parsed.segments?.map?.((seg) => seg?.text ?? '').join(' ').trim(),
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    }
  }

  return ''
}