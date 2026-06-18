import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const extensionRoot = path.resolve(__dirname, '..')
const outDir = path.join(extensionRoot, 'dist', 'embedded-runtime')
const entryPoint = path.join(extensionRoot, 'src', 'embedded-runtime', 'entry.mjs')

await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })

await build({
  entryPoints: [entryPoint],
  outfile: path.join(outDir, 'index.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  external: ['node:*', 'ws'],
  logLevel: 'info',
})
