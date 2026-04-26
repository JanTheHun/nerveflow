# News Agent (Phase 1)

Deterministic news-agent scaffold focused on one vertical slice:

- timer-driven polling (`news_tick`)
- single-article prioritization with contract validation
- urgent visual alert + alert tool dispatch
- unread query summarization for user messages

## Scope

Implemented in workflow:

- `intent.nrv`: routes `user_message` to unread summary flow
- `ingest.nrv`: polls one article, classifies priority, stores article, emits urgent alerts
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
- `store_article`
- `query_articles`
- `send_alert`
- `mark_read`

Without host implementations, tool calls will be rejected as unavailable.

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

To add domain tools, create a `host_modules` provider in your workspace and register it:

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

Mark read:

```powershell
node bin/nerve-attach.js ws://127.0.0.1:4201/api/runtime/ws enqueue mark_read "article-123"
```
