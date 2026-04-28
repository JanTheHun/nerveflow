import { createPublicFileStoreProvider } from './file_store.js'
export { createPollingIngressConnector } from './polling_ingress_connector.js'
export {
  buildSyntheticRssItem,
  fetchRssCandidatesByFeed,
  mapRssItemsToIngressEvents,
  normalizeFeedList,
  normalizeRssItem,
  pickNewRssItemsFromFeeds,
  pickNextRssItemFromFeeds,
  sourceFromFeed,
} from './rss_source.js'

export function createPublicHostModuleProviders(context = {}) {
  return [
    createPublicFileStoreProvider(context),
  ]
}
