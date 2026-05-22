import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)))
const root = resolve(__dirname, '..')

const strict = process.argv.includes('--strict')
const maxPrint = 120

const cssFile = resolve(root, 'nerve-studio/public/styles.css')
const jsDir = resolve(root, 'nerve-studio/public/src-app')

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g

function listJsFiles(dirPath) {
  const out = []
  const entries = readdirSync(dirPath)
  for (const entry of entries) {
    const full = resolve(dirPath, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listJsFiles(full))
      continue
    }
    if (st.isFile() && extname(full) === '.js') {
      out.push(full)
    }
  }
  return out
}

function isAllowedCssLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) return true
  if (/^--[a-z0-9-]+\s*:/.test(trimmed)) return true
  if (trimmed.includes('color-guard-ignore')) return true
  return false
}

function isAllowedJsLine(line) {
  const trimmed = line.trim()
  if (!trimmed) return true
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return true
  if (trimmed.includes('color-guard-ignore')) return true
  // Allow explicit fallback values in token resolver helper calls.
  if (trimmed.includes('getThemeColorToken(')) return true
  return false
}

function scanFile(filePath, kind) {
  const text = readFileSync(filePath, 'utf8')
  const lines = text.split(/\r?\n/)
  const findings = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    COLOR_RE.lastIndex = 0
    if (!COLOR_RE.test(line)) continue

    const allowed = kind === 'css' ? isAllowedCssLine(line) : isAllowedJsLine(line)
    if (allowed) continue

    findings.push({
      filePath,
      line: i + 1,
      text: line.trim(),
    })
  }

  return findings
}

const filesToScan = [
  { filePath: cssFile, kind: 'css' },
  ...listJsFiles(jsDir).map((filePath) => ({ filePath, kind: 'js' })),
]

let findings = []
for (const item of filesToScan) {
  findings = findings.concat(scanFile(item.filePath, item.kind))
}

const rel = (filePath) => filePath.replace(root + '\\', '').replace(/\\/g, '/')

if (findings.length === 0) {
  console.log('Studio color guard: no hardcoded color literals found outside allowlisted lines.')
  process.exit(0)
}

console.log(`Studio color guard: found ${findings.length} potential hardcoded color literals.`)
console.log('Allowlisted: CSS custom property declarations, getThemeColorToken() fallback lines, and lines marked color-guard-ignore.')

const grouped = new Map()
for (const finding of findings) {
  const key = rel(finding.filePath)
  grouped.set(key, (grouped.get(key) ?? 0) + 1)
}

console.log('By file:')
for (const [filePath, count] of grouped.entries()) {
  console.log(`  ${filePath}: ${count}`)
}

console.log('Sample findings:')
for (const finding of findings.slice(0, maxPrint)) {
  console.log(`  ${rel(finding.filePath)}:${finding.line} ${finding.text}`)
}

if (findings.length > maxPrint) {
  console.log(`  ... ${findings.length - maxPrint} more`) 
}

if (strict) {
  console.error('Studio color guard strict mode: failing due to hardcoded color literals.')
  process.exit(1)
}

console.log('Studio color guard running in report mode (non-failing). Use --strict to enforce.')
process.exit(0)
