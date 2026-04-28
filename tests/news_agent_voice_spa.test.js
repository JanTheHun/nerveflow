import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPiperLaunchConfig,
  buildWhisperLaunchConfig,
  extractOutputText,
  extractTranscript,
  parseDotEnv,
  pickAudioExtension,
  splitCommandArgs,
} from '../examples/news-agent/voice-spa/server_lib.js'

test('parseDotEnv parses quoted values', () => {
  const env = parseDotEnv([
    '# comment',
    'WHISPER_RUN_PATH="C:/tools/whisper.exe"',
    'VOICE_INGRESS_NAME=user_message',
  ].join('\n'))

  assert.equal(env.WHISPER_RUN_PATH, 'C:/tools/whisper.exe')
  assert.equal(env.VOICE_INGRESS_NAME, 'user_message')
})

test('splitCommandArgs keeps quoted spans together', () => {
  const args = splitCommandArgs('--input "{input}" --format json')
  assert.deepEqual(args, ['--input', '{input}', '--format', 'json'])
})

test('buildWhisperLaunchConfig appends input when args omit placeholder', () => {
  const launch = buildWhisperLaunchConfig({
    WHISPER_RUN_PATH: 'C:/tools/whisper.exe',
    WHISPER_RUN_ARGS: '--language en',
  }, 'C:/tmp/audio.webm')

  assert.equal(launch.command, 'C:/tools/whisper.exe')
  assert.deepEqual(launch.args, ['--language', 'en', 'C:/tmp/audio.webm'])
})

test('buildWhisperLaunchConfig expands model placeholder', () => {
  const launch = buildWhisperLaunchConfig({
    WHISPER_RUN_PATH: 'C:/tools/whisper.exe',
    WHISPER_RUN_ARGS: '-m "{model}" -oj "{input}"',
    WHISPER_MODEL: 'C:/models/base.bin',
  }, 'C:/tmp/audio.webm')

  assert.equal(launch.command, 'C:/tools/whisper.exe')
  assert.match(launch.args.join(' '), /base\.bin/)
  assert.match(launch.args.join(' '), /audio\.webm/)
})

test('buildWhisperLaunchConfig expands cmd wrapper with placeholder', () => {
  const launch = buildWhisperLaunchConfig({
    WHISPER_RUN_PATH: 'C:/tools/run-whisper.cmd',
    WHISPER_RUN_ARGS: '--input "{input}"',
  }, 'C:/tmp/audio.webm')

  assert.equal(launch.command, 'cmd.exe')
  assert.equal(launch.args[0], '/d')
  assert.match(launch.args[3], /run-whisper\.cmd/)
  assert.match(launch.args[3], /audio\.webm/)
})

test('extractTranscript handles whisper.cpp transcription array', () => {
  const transcript = extractTranscript({
    result: { language: 'en' },
    transcription: [{ text: ' what news' }, { text: ' today' }],
  })
  assert.equal(transcript, 'what news  today')
})

test('extractTranscript prefers structured output text', () => {
  const transcript = extractTranscript({text: 'what news'})
  assert.equal(transcript, 'what news')
})

test('extractTranscript extracts from transcript field', () => {
  const transcript = extractTranscript({transcript: 'what news'})
  assert.equal(transcript, 'what news')
})

test('extractTranscript extracts from nested result.text', () => {
  const transcript = extractTranscript({result: {text: 'what news'}})
  assert.equal(transcript, 'what news')
})

test('extractTranscript extracts from segments array', () => {
  const transcript = extractTranscript({segments: [{text: 'what news'}]})
  assert.equal(transcript, 'what news')
})

test('extractTranscript falls back to empty string for invalid input', () => {
  const transcript = extractTranscript(null)
  assert.equal(transcript, '')
})

test('buildPiperLaunchConfig expands model and output placeholders', () => {
  const launch = buildPiperLaunchConfig({
    PIPER_RUN_PATH: 'C:/tools/piper.exe',
    PIPER_MODEL: 'C:/models/voice.onnx',
    PIPER_RUN_ARGS: '--model "{model}" --output_file "{output}"',
  }, 'C:/tmp/tts-out.wav')

  assert.equal(launch.command, 'C:/tools/piper.exe')
  assert.match(launch.args.join(' '), /voice\.onnx/)
  assert.match(launch.args.join(' '), /tts-out\.wav/)
})

test('extractOutputText reads runtimeEvent.value string', () => {
  const text = extractOutputText({ runtimeEvent: { value: 'hello world' } })
  assert.equal(text, 'hello world')
})

test('extractOutputText serializes object value', () => {
  const text = extractOutputText({ runtimeEvent: { value: { title: 'news' } } })
  assert.equal(text, JSON.stringify({ title: 'news' }))
})

test('extractOutputText returns empty for missing payload', () => {
  assert.equal(extractOutputText(null), '')
  assert.equal(extractOutputText({}), '')
})

test('pickAudioExtension maps common media types', () => {
  assert.equal(pickAudioExtension('audio/webm;codecs=opus'), '.webm')
  assert.equal(pickAudioExtension('audio/wav'), '.wav')
  assert.equal(pickAudioExtension('audio/mp4'), '.m4a')
})