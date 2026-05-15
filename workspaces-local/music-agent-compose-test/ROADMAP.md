# Music Agent Example — Portability Roadmap

## Goal

Make the music-agent example usable by anyone without shipping private knowledge data.
The user builds her own music knowledge base incrementally, through explicit commands.
Indexing is never automatic — the user decides when and what to index.

---

## Current state

- Knowledge retrieval and playback selection are fully functional.
- Memory is backed by a PostgreSQL+pgvector instance wired in `host_modules/index.js`.
- There is no mechanism for a new user to populate the memory from her own library.
- The example currently requires a pre-populated database to return meaningful results.

---

## Phase 1 — Root folder declaration and command surface

**Goal:** Let the user declare where her music lives and expose explicit indexing commands.

### 1.1 — Root folder configuration

- Add `MUSIC_LIBRARY_ROOT` to `.env.example` with a clear placeholder and comment.
- Read the value in `host_modules/index.js` alongside the existing DB and embedding env vars.
- Optionally persist the root path in workspace-local JSON (via the existing `store_file_json` pattern) so it survives across restarts without re-declaring it on every invocation.

### 1.2 — New external events in `nextv.json`

Add to the `externals` array:

| Event | Description |
|---|---|
| `set_music_root` | Declare or update the local library root path |
| `index_music` | Trigger incremental indexing from the configured root |
| `index_music_folder` | Trigger incremental indexing of a specific subfolder |
| `index_status` | Report the current index state (root, counts, last run) |

### 1.3 — Workflow handlers in `memory.nrv`

Add `on external` blocks for each new event. Each handler must:

- Call the corresponding host tool.
- Emit a deterministic `output json` response with a clear status field.
- Never auto-trigger indexing as a side effect of unrelated events.

Example response contract for `index_music`:

```json
{
  "status": "indexed",
  "root": "/path/to/music",
  "discovered": 412,
  "indexed": 38,
  "skipped": 374,
  "errors": 0,
  "duration_ms": 4200
}
```

---

## Phase 2 — Discovery and incremental indexing tools

**Goal:** Implement host-side tools that scan a declared root folder and ingest only new or changed files.

### 2.1 — New tools in `host_modules/index.js`

| Tool | Inputs | Output |
|---|---|---|
| `music_set_root` | `root` (path string) | `{ ok, root }` |
| `music_get_root` | — | `{ ok, root, set_at }` |
| `music_discover_files` | `root`, `extensions?`, `max_files?` | `{ ok, root, count, files[] }` |
| `music_index_files` | `root`, `mode?` (`incremental`/`full`) | `{ ok, root, discovered, indexed, skipped, errors, duration_ms }` |
| `music_index_folder` | `folder` (subfolder of root), `mode?` | same shape as above |
| `music_index_status` | — | `{ ok, root, total_indexed, last_run_at, last_run_counts }` |

All tools validate that the target path is within the declared root. No path traversal outside root is permitted.

### 2.2 — File discovery

- Recursive scan of the declared root for `.mp3` files (MVP; extensible to `.flac`, `.ogg`, etc. later).
- Configurable `max_files` per invocation to prevent runaway scans on large libraries.
- Errors on individual files are counted and reported, never thrown — the batch continues.

### 2.3 — Chunk generation

For each discovered file, generate a plain-text chunk from locally-available signals only:

- Filename tokens (without extension).
- Folder path tokens relative to root (artist/album hints).
- Optional: file size and last-modified date as supplementary context.

No external services, no audio decoding, no network calls needed at this stage.

Example chunk text for `/music/Boards of Canada/Music Has the Right to Children/01 Wildlife Analysis.mp3`:

```
Artist: Boards of Canada
Album: Music Has the Right to Children
Track: 01 Wildlife Analysis
```

Store with metadata:

```json
{
  "category": "music",
  "source_type": "local_file",
  "root": "/music",
  "relative_path": "Boards of Canada/Music Has the Right to Children/01 Wildlife Analysis.mp3",
  "extension": "mp3",
  "fingerprint": "<hash of normalized_path + mtimeMs + size>"
}
```

### 2.4 — Incremental deduplication

- Before storing a chunk, check whether a memory record with the same `fingerprint` metadata already exists.
- If the fingerprint matches: skip (count as `skipped`).
- If the file path exists but fingerprint changed: update the existing record via `memory_update`.
- If the file is new: store via `memory_store` and count as `indexed`.
- If a previously-indexed file no longer exists on disk: leave it in memory (orphan cleanup is a separate, explicit command, deferred to a later phase).

---

## Phase 3 — Retrieval alignment

**Goal:** Ensure user-indexed local tracks are treated as first-class results in the existing selection flow.

### 3.1 — Metadata filter alignment

- Update `music-select.nrv` to ensure `filter_metadata` handles both legacy chunks and new `source_type: local_file` chunks.
- Confirm that `category: music` is set consistently on all new chunks so existing retrieval is not broken.

### 3.2 — Confidence handling

- Review the similarity threshold in `user-wants-music.nrv` (`limit = 0.6`) — may need tuning when results come from local-file chunks rather than richer preloaded descriptions.
- Document the tuning variable in a comment rather than hardcoding a new value.

---

## Phase 4 — Validation and documentation

**Goal:** Cover new tool and workflow behavior with tests; document the manual indexing flow for a new user.

### 4.1 — Host module tool tests

Add tests in `tests/` following the patterns in `tests/host_modules.test.js`:

- Root validation: rejects paths outside root, rejects missing directories.
- Discovery: correct file count on known fixture folder, respects `max_files` cap.
- Incremental skip: second run on unchanged folder produces `indexed: 0, skipped: N`.
- Fingerprint change: modified file gets updated in memory, not duplicated.
- Tool output shapes: each tool returns the expected contract fields.

### 4.2 — Workflow handler tests

- `set_music_root` handler returns well-formed response with `status: "root_set"`.
- `index_music` handler returns `status: "indexed"` with numeric count fields.
- `index_status` handler returns current snapshot even before any indexing.
- No indexing is triggered by `user_message` or any other unrelated external event.

### 4.3 — Example documentation

Add (or update) a `README.md` in the music-agent workspace covering:

1. Prerequisites: PostgreSQL+pgvector, Ollama with embedding model.
2. Setup: copy `.env.example` to `.env`, fill in `MUSIC_LIBRARY_ROOT` and DB URL.
3. How to index your library: send `index_music` command, wait for status response.
4. How to index incrementally: run `index_music` again any time you add files — unchanged files are skipped automatically.
5. How to check index state: send `index_status`.
6. How to query: normal `user_message` flow unchanged.
7. Troubleshooting: embedding model not found, DB connection error, files not appearing in results.

---

## Out of scope (explicitly excluded)

- Automatic indexing on first start or on any non-indexing event.
- Shipping any preloaded private knowledge data with the example.
- ID3 tag parsing (deferred; would require an external dependency).
- Orphan cleanup of deleted files (deferred; should be an explicit command).
- Watching the filesystem for changes (deferred; outside the deterministic workflow model).
- Scanning machine-wide paths without an explicit user-declared root.

---

## Execution order

```
Phase 1.1 → 1.2 → 1.3
Phase 2.1 → 2.2 → 2.3 → 2.4   (parallel with Phase 1.3 once tool contracts are defined)
Phase 3.1 → 3.2                 (after Phase 2.3)
Phase 4.1 → 4.2 → 4.3          (after Phase 2.4 and Phase 3)
```
