import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createEffectRealizerRuntime, createIngressConnectorRuntime } from '../src/host_core/index.js'
import { createPiperEffectRealizer, createWhisperIngressConnector } from '../src/host_modules/public/index.js'

test('createWhisperIngressConnector dispatches transcript events from audio payload', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nerveflow-whisper-connector-'))
  const runnerPath = path.join(tempRoot, 'mock-whisper.js')

  await writeFile(
    runnerPath,
    [
      "import { writeFileSync } from 'node:fs'",
      'const args = process.argv.slice(2)',
      "const outputArgIndex = args.indexOf('--output-json')",
      "const outputPath = outputArgIndex >= 0 ? args[outputArgIndex + 1] : ''",
      'if (!outputPath) process.exit(2)',
      "writeFileSync(outputPath, JSON.stringify({ transcription: [{ text: 'hello from whisper' }] }))",
      'process.exit(0)',
      '',
    ].join('\n'),
    'utf8',
  )

  try {
    const connector = createWhisperIngressConnector({
      ingressName: 'voice_audio',
      eventType: 'user_message',
      cwd: tempRoot,
      env: {
        WHISPER_RUN_PATH: runnerPath,
        WHISPER_RUN_ARGS: '--input "{input}" --output-json "{output}.json"',
      },
    })

    const runtime = createIngressConnectorRuntime({ connectors: [connector] })
    const result = await runtime.dispatch({
      name: 'voice_audio',
      value: {
        audioBase64: Buffer.from('audio-bytes').toString('base64'),
        contentType: 'audio/wav',
      },
    })

    assert(Array.isArray(result), 'ingress connector should return array events')
    assert.equal(result[0]?.type, 'user_message')
    assert.equal(result[0]?.value, 'hello from whisper')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})

test('createPiperEffectRealizer synthesizes base64 audio output', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'nerveflow-piper-realizer-'))
  const runnerPath = path.join(tempRoot, 'mock-piper.js')

  await writeFile(
    runnerPath,
    [
      "import { writeFileSync } from 'node:fs'",
      'const args = process.argv.slice(2)',
      "const outputArgIndex = args.indexOf('--output_file')",
      "const outputPath = outputArgIndex >= 0 ? args[outputArgIndex + 1] : ''",
      "let stdinText = ''",
      "process.stdin.on('data', (chunk) => { stdinText += String(chunk) })",
      "process.stdin.on('end', () => {",
      "  if (!outputPath) process.exit(2)",
      "  const payload = Buffer.from(`RIFF-${stdinText || 'empty'}`)",
      '  writeFileSync(outputPath, payload)',
      '  process.exit(0)',
      '})',
      '',
    ].join('\n'),
    'utf8',
  )

  try {
    const realizer = createPiperEffectRealizer({
      effectName: 'voice',
      cwd: tempRoot,
      env: {
        PIPER_RUN_PATH: runnerPath,
        PIPER_RUN_ARGS: '--model "{model}" --output_file "{output}"',
        PIPER_MODEL: './mock/model.onnx',
      },
    })

    const runtime = createEffectRealizerRuntime({ realizers: [realizer] })
    const result = await runtime.realize({ name: 'voice', value: 'hello world' })

    assert.equal(typeof result?.audioBase64, 'string')
    assert.equal(result.audioBase64.length > 0, true)
    assert.equal(result.mimeType, 'audio/wav')
    assert.equal(result.text, 'hello world')
  } finally {
    await rm(tempRoot, { recursive: true, force: true })
  }
})
