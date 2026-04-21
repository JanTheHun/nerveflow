const TOOL_METADATA = {
  read_file: { effectful: false, categories: ['filesystem'], needsConfirmation: false },
  write_file: { effectful: true, categories: ['filesystem'], needsConfirmation: true },
  append_file: { effectful: true, categories: ['filesystem'], needsConfirmation: true },
  list_directory: { effectful: false, categories: ['filesystem'], needsConfirmation: false },
  run_command: { effectful: true, categories: ['process'], needsConfirmation: true },
  speak: { effectful: true, categories: ['audio'], needsConfirmation: false },
  render_view: { effectful: true, categories: ['visual'], needsConfirmation: false },
  get_time: { effectful: false, categories: ['time'], needsConfirmation: false }
}

export function getToolMetadata(name) {
  const key = String(name ?? '').trim()
  if (!key) return null

  const metadata = TOOL_METADATA[key]
  if (!metadata) return null

  return {
    effectful: metadata.effectful === true,
    categories: Array.isArray(metadata.categories) ? [...metadata.categories] : [],
    needsConfirmation: metadata.needsConfirmation === true
  }
}
