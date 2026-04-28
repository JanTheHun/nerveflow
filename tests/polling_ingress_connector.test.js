import test from 'node:test'
import assert from 'node:assert/strict'
import { createPollingIngressConnector } from '../src/host_modules/public/polling_ingress_connector.js'

test('createPollingIngressConnector maps polled items into events', async () => {
  const connector = createPollingIngressConnector({
    poll: async () => ({ items: [{ id: 'a' }, { id: 'b' }] }),
    mapItemToEvent: (item, { eventType }) => ({ type: eventType, value: item.id }),
    defaultEventType: 'rss_item',
  })

  const events = await connector({ eventType: 'rss_ingested' })
  assert.deepEqual(events, [
    { type: 'rss_ingested', value: 'a' },
    { type: 'rss_ingested', value: 'b' },
  ])
})

test('createPollingIngressConnector supports mapItemsToEvents and empty payloads', async () => {
  const connector = createPollingIngressConnector({
    poll: async () => ({ items: [{ id: 'a' }] }),
    mapItemsToEvents: (items, { input }) => {
      if (input.skip === true) return []
      return items.map((item) => ({ type: 'x', value: item }))
    },
  })

  const skipped = await connector({ skip: true })
  assert.deepEqual(skipped, [])

  const mapped = await connector({})
  assert.deepEqual(mapped, [{ type: 'x', value: { id: 'a' } }])
})
