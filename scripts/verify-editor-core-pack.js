#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const packageRoot = resolve(repoRoot, 'packages/editor-core')

function runCommand(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun({ stdout, stderr })
        return
      }
      rejectRun(new Error(
        `${command} ${args.join(' ')} failed (code=${code}, signal=${signal ?? 'none'})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
      ))
    })
  })
}

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return runCommand('cmd.exe', ['/c', 'npm', ...args], options)
  }
  return runCommand('npm', args, options)
}

function isAllowedPath(path) {
  if (path === 'package.json' || path === 'README.md') {
    return true
  }
  return path.startsWith('src/') || path.startsWith('docs/')
}

async function main() {
  console.log('[editor-core-pack] running npm pack --json --dry-run')
  const result = await runNpm(['pack', '--json', '--dry-run'], { cwd: packageRoot })

  let packEntries = []
  try {
    packEntries = JSON.parse(String(result.stdout || '[]'))
  } catch (error) {
    throw new Error(`Unable to parse npm pack JSON output:\n${String(result.stdout || '')}\n${error.message}`)
  }

  const pack = packEntries[0]
  if (!pack || !Array.isArray(pack.files)) {
    throw new Error(`npm pack did not include a files list:\n${JSON.stringify(packEntries, null, 2)}`)
  }

  const packedPaths = pack.files
    .map((entry) => String(entry?.path || ''))
    .filter(Boolean)
    .sort()

  const requiredPaths = [
    'package.json',
    'README.md',
    'src/index.js',
    'src/Surface.js',
    'src/Renderer.js',
    'src/Diagnostics.js',
    'docs/HOST_CONTRACT.md',
    'docs/PLUGIN_CONTRACT.md',
  ]

  const missingRequired = requiredPaths.filter((path) => !packedPaths.includes(path))
  const disallowed = packedPaths.filter((path) => !isAllowedPath(path))
  const hasSrcFiles = packedPaths.some((path) => path.startsWith('src/'))
  const hasDocsFiles = packedPaths.some((path) => path.startsWith('docs/'))

  if (missingRequired.length > 0) {
    throw new Error(`Missing required packed files:\n- ${missingRequired.join('\n- ')}`)
  }

  if (!hasSrcFiles || !hasDocsFiles) {
    throw new Error('Packed artifact must include both src/ and docs/ files')
  }

  if (disallowed.length > 0) {
    throw new Error(`Disallowed files detected in packed artifact:\n- ${disallowed.join('\n- ')}`)
  }

  console.log('[editor-core-pack] packed files:')
  for (const path of packedPaths) {
    console.log(`  - ${path}`)
  }

  console.log('[editor-core-pack] pass')
}

main().catch((error) => {
  console.error('[editor-core-pack] fail')
  console.error(error?.stack || String(error))
  process.exit(1)
})
