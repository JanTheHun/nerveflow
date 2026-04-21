import express from 'express'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runNextVScript } from '../../src/index.js'

const app = express()
const port = Number(process.env.PORT ?? 4173)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const exampleScriptPath = resolve(join(__dirname, 'workflow.nrv'))

app.use(express.json())

function createHostAdapter() {
  return {
    // Host-owned implementations: replace these stubs with your real integrations.
    async callTool(name, args) {
      if (name === 'get_time') return new Date().toISOString()
      return JSON.stringify({ ok: true, tool: name, args: args ?? {} })
    },
    async callAgent(prompt) {
      return JSON.stringify({
        status: 'ready',
        decision: 'mock',
        prompt,
      })
    },
    async callScript(path, state) {
      const source = readFileSync(path, 'utf8')
      const result = await runNextVScript(source, {
        state,
        hostAdapter: createHostAdapter(),
      })
      return {
        state: result.state,
        returnValue: result.returnValue,
      }
    },
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/run', async (req, res) => {
  try {
    const source = typeof req.body?.source === 'string' && req.body.source.trim()
      ? req.body.source
      : readFileSync(exampleScriptPath, 'utf8')

    const inputEvent = req.body?.event ?? { type: 'user_message', value: 'hello' }
    const state = req.body?.state && typeof req.body.state === 'object' ? req.body.state : {}
    const runtimeEvents = []

    const result = await runNextVScript(source, {
      state,
      event: inputEvent,
      hostAdapter: createHostAdapter(),
      onEvent: (eventRecord) => {
        runtimeEvents.push(eventRecord)
      },
    })

    res.json({
      ok: true,
      state: result.state,
      locals: result.locals,
      returnValue: result.returnValue,
      runtimeEvents,
    })
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error?.message ?? 'Unknown error',
      code: error?.code ?? null,
      line: error?.line ?? null,
    })
  }
})

app.listen(port, '127.0.0.1', () => {
  console.log(`minimal host listening on http://127.0.0.1:${port}`)
})
