import { createPublicFileStoreProvider } from './file_store.js'

export function createPublicHostModuleProviders(context = {}) {
  return [
    createPublicFileStoreProvider(context),
  ]
}
