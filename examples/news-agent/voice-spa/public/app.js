const recordButton = document.getElementById('record-btn')
const statusLabel = document.getElementById('status')
const transcriptLabel = document.getElementById('transcript')

let mediaRecorder = null
let mediaStream = null
let chunks = []
let isRecording = false
let outputEventSource = null

function setStatus(text, isError = false) {
  statusLabel.textContent = text
  statusLabel.dataset.error = isError ? 'true' : 'false'
}

function setTranscript(text) {
  const value = String(text ?? '').trim()
  if (!value) {
    transcriptLabel.hidden = true
    transcriptLabel.textContent = ''
    return
  }
  transcriptLabel.hidden = false
  transcriptLabel.textContent = value
}

async function playAudioBase64(base64) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const audioContext = new AudioContext()
  const audioBuffer = await audioContext.decodeAudioData(bytes.buffer)
  const source = audioContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioContext.destination)
  source.start()
  return new Promise((resolve) => { source.onended = resolve })
}

function connectOutputStream() {
  if (outputEventSource) outputEventSource.close()
  outputEventSource = new EventSource('/api/output/stream')

  outputEventSource.addEventListener('stream_open', () => {
    console.log('[output stream] connected')
  })

  outputEventSource.addEventListener('voice_output', async (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      console.log('[voice output]', payload.text)
      setTranscript(`🔊 ${payload.text}`)
      if (payload.audioBase64) {
        await playAudioBase64(payload.audioBase64)
      } else if (payload.error) {
        setTranscript(`🔇 ${payload.text} (tts error: ${payload.error})`)
      }
    } catch (err) {
      console.error('[voice output error]', err)
    }
  })

  outputEventSource.addEventListener('error', () => {
    console.warn('[output stream] disconnected, retrying in 3s...')
    outputEventSource.close()
    outputEventSource = null
    setTimeout(connectOutputStream, 3000)
  })
}

connectOutputStream()

function getSupportedMimeType() {
  const options = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  return options.find((value) => window.MediaRecorder?.isTypeSupported?.(value)) ?? ''
}

async function encodeToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer()
  const audioContext = new AudioContext()
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  audioContext.close()

  const numChannels = 1
  const sampleRate = audioBuffer.sampleRate
  const samples = audioBuffer.getChannelData(0)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  const dataLength = pcm.byteLength
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const write = (off, str) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }

  write(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, dataLength, true)
  new Int16Array(buffer, 44).set(pcm)

  return new Blob([buffer], { type: 'audio/wav' })
}

async function sendRecording(blob) {
  setStatus('transcribing...')
  const wav = await encodeToWav(blob)
  const response = await fetch('/api/voice-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'audio/wav',
    },
    body: wav,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.error ?? 'voice command failed')
  }

  console.log('[voice-command response]', payload)
  setTranscript(payload.transcript)
  setStatus('sent')
}

async function stopRecording() {
  if (!mediaRecorder || !isRecording) return
  mediaRecorder.stop()
  isRecording = false
  recordButton.textContent = 'record'
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus('browser does not support microphone recording', true)
    return
  }

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const mimeType = getSupportedMimeType()
  mediaRecorder = mimeType
    ? new MediaRecorder(mediaStream, { mimeType })
    : new MediaRecorder(mediaStream)
  chunks = []

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data)
    }
  })

  mediaRecorder.addEventListener('stop', async () => {
    try {
      setStatus('uploading...')
      const blob = new Blob(chunks, { type: mimeType || mediaRecorder.mimeType || 'audio/webm' })
      await sendRecording(blob)
    } catch (error) {
      setStatus(error?.message ?? 'recording failed', true)
    } finally {
      chunks = []
      if (mediaStream) {
        for (const track of mediaStream.getTracks()) {
          track.stop()
        }
      }
      mediaStream = null
      mediaRecorder = null
    }
  }, { once: true })

  mediaRecorder.start()
  isRecording = true
  setTranscript('')
  setStatus('listening...')
  recordButton.textContent = 'stop'
}

recordButton?.addEventListener('click', async () => {
  recordButton.disabled = true
  try {
    if (isRecording) {
      await stopRecording()
    } else {
      await startRecording()
    }
  } catch (error) {
    setStatus(error?.message ?? 'unable to access microphone', true)
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop()
      }
    }
    mediaStream = null
    mediaRecorder = null
    isRecording = false
    recordButton.textContent = 'record'
  } finally {
    recordButton.disabled = false
  }
})