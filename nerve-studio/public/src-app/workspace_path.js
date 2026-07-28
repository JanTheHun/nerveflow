export function normalizeWorkspacePath(pathValue) {
  const raw = String(pathValue ?? '').trim()
  if (!raw) return ''

  const slashified = raw.replace(/\\/g, '/')
  const isUncAbsolute = slashified.startsWith('//')
  const isWindowsDriveAbsolute = /^[a-zA-Z]:\//.test(slashified)
  const isPosixAbsolute = slashified.startsWith('/')
  const isAbsolute = isUncAbsolute || isWindowsDriveAbsolute || isPosixAbsolute

  let normalized = isUncAbsolute
    ? `//${slashified.slice(2).replace(/\/+/, '/').replace(/\/+/g, '/')}`
    : slashified.replace(/\/+/g, '/')

  if (normalized === '.' || normalized === './') return ''

  if (!isAbsolute) {
    normalized = normalized
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
  }

  const isPosixRoot = normalized === '/'
  const isWindowsDriveRoot = /^[a-zA-Z]:\/$/.test(normalized)
  if (!isPosixRoot && !isWindowsDriveRoot) {
    normalized = normalized.replace(/\/+$/, '')
  }

  return normalized
}