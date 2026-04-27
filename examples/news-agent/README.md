# News Agent (Phase 1)

Deterministic news-agent scaffold focused on one vertical slice:

- timer-driven polling (`news_tick`)
- batch fetch/filter of new unread articles with dedupe
- batch prioritization (all new articles) with contract validation
- urgent visual alert + alert tool dispatch
- unread query summarization for user messages

## Scope

Implemented in workflow:

- `intent.nrv`: routes `user_message` to unread summary flow
- `ingest.nrv`: polls new articles, classifies all priorities in one call, stores results, emits urgent alerts
- `summary.nrv`: summarizes unread articles for user query
- `topics.nrv`: updates favorite topics
- `read.nrv`: marks article as read

Configured assets:

- `agents.json`: `priority` and `summarizer` profiles
- `tools.json`: allowed tool IDs for host policy
- `contracts/`: structured decision/output contracts
- `prompts/`: prompt files for classifier and summarizer

## Required Host Tools

This workflow expects host tool implementations for:

- `poll_next_article`
- `poll_new_articles`
- `store_article`
- `store_articles_batch`
- `query_articles`
- `send_alert`
- `mark_read`

This example now includes a local workspace provider at `host_modules/index.js` that implements these tools for local development.

Provider behavior notes:

- `poll_new_articles` uses builtin `rss_fetch` to fetch feeds, filter unseen articles, dedupe by id, and persist unread items to the local store.
- `poll_next_article` remains available for compatibility and returns one unseen article.
- If feeds are temporarily unavailable, it falls back to synthetic deterministic articles so ingest workflows can still be exercised offline.

## Host Integration

This example relies on real host-side tool plumbing. The workflow requires domain-specific tool implementations:

- `poll_next_article` — fetch next article from RSS sources
- `store_article` — persist article to database
- `query_articles` — search stored articles by topic/date
- `send_alert` — notify user of urgent articles
- `mark_read` — mark article as read

### Using the standalone runtime

The `nerve-runtime` process includes generic builtin tools:

- `get_time`, `http_fetch`, `rss_fetch`

This example already includes a workspace host provider:

- `examples/news-agent/host_modules/index.js`

If you want to replace it with a custom implementation, create your own `host_modules` provider in the workspace:

**Create `host_modules/news_provider.js`:**

```javascript
export function createNewsProvider() {
  return {
    poll_next_article: async ({ args }) => {
      // Implement RSS polling logic
      return { id, title, source, url }
    },
    store_article: async ({ args }) => {
      // Implement article storage
      return { stored: true }
    },
    query_articles: async ({ args }) => {
      // Implement article search
      return { articles: [] }
    },
    send_alert: async ({ args }) => {
      // Implement alert dispatch
      return { sent: true }
    },
    mark_read: async ({ args }) => {
      // Implement read tracking
      return { marked: true }
    },
  }
}
```

**Create `host_modules/index.js`:**

```javascript
export { createNewsProvider } from './news_provider.js'
```

Then update `nerve-runtime.js` to load your provider via `loadHostModules`:

```javascript
import { loadHostModules } from '../src/host_modules/index.js'

// Workspace providers are discovered from host_modules directory
const providers = await loadHostModules({ workspaceDir })
const toolRuntime = createToolRuntime({ providers })
```

The `loadHostModules` function will compose both builtin and workspace providers in order. See [host-modules README](../../src/host_modules/README.md) for detailed provider registration semantics.

## Run

From repository root:

```powershell
node bin/nerve-runtime.js start examples/news-agent --port 4201
```

Example user query:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue user_message "What should I read first?"
```

Set favorite topics:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue set_topics "[\"ai\",\"energy\"]"
```

Manual poll trigger:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue trigger.poll
```

Unread priority summary:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue trigger.priority_summary
```

Mark read:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue mark_read "article-123"
```
