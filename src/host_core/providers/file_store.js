import { createPublicFileStoreProvider } from '../../host_modules/public/index.js'

/**
 * fileStoreProvider creates a file-based storage provider.
 *
 * Configuration:
 *   basePath: Base directory for file storage (default: workspace root)
 *
 * Provides tools:
 *   - store_file_json(key, value)
 *   - get_file_json(key)
 *   - list_file_keys()
 *   - delete_file(key)
 */
export function fileStoreProvider(config = {}) {
  return createPublicFileStoreProvider(config)
}
