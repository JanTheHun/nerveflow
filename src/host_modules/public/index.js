import { createPublicFileStoreProvider } from './file_store.js'
export { createPollingIngressConnector } from './polling_ingress_connector.js'
export { createMemoryProvider } from './memory_provider.js'
export { createWhisperIngressConnector } from './whisper_ingress_connector.js'
export { createPiperEffectRealizer } from './piper_effect_realizer.js'
export {
  buildPiperLaunchConfig,
  buildWhisperLaunchConfig,
  executeSpeechProcess,
  extractOutputText,
  extractTranscript,
  pickAudioExtension,
  splitCommandArgs,
} from './speech_process.js'
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
