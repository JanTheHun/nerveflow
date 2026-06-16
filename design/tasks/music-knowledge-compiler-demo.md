# Music Knowledge Compiler Demo

## Overview

This demo explores a simple but powerful idea inspired by knowledge compilation systems:

> Study a domain, extract entities and relationships, and build a durable knowledge artifact.

Instead of storing only embeddings and text chunks, the system compiles structured knowledge that can be inspected, queried, and evolved over time.

The goal is not to build a universal knowledge graph.

The goal is to test whether Nerveflow can orchestrate the creation of durable knowledge artifacts using existing primitives.

---

## Why This Demo

A music domain is ideal because it is:

- bounded
- rich in relationships
- easy to validate manually
- understandable to users

Example questions:

- Which album contains Paranoid Android?
- What albums were released before Kid A?
- Which artists influenced Radiohead?
- Which songs belong to OK Computer?

Many of these become graph traversals instead of semantic search problems.

---

## Core Hypothesis

Nerveflow should not be the knowledge base.

Nerveflow should orchestrate the knowledge compiler.

```text
sources
    ↓
knowledge extraction
    ↓
entity generation
    ↓
relationship generation
    ↓
knowledge store
    ↓
query
```

This aligns with the Nerveflow philosophy:

- deterministic orchestration
- probabilistic extraction
- inspectable artifacts

---

## Knowledge Schema

```json
{
  "category": "music",
  "type": "artist",
  "attributes": {
    "name": "Radiohead",
    "country": "United Kingdom"
  },
  "relations": [
    {
      "type": "influenced_by",
      "target": "talking-heads"
    }
  ]
}
```

Generic shape:

```json
{
  "category": "...",
  "type": "...",
  "attributes": {},
  "relations": []
}
```

The schema is intentionally domain-agnostic.

---

## Initial Entity Types

### Artist

Examples:

- Radiohead
- Pink Floyd
- Garbage

### Album

Examples:

- OK Computer
- Kid A
- The Dark Side of the Moon

### Song

Examples:

- Paranoid Android
- Karma Police

### Person

Examples:

- Thom Yorke
- Jonny Greenwood

### Genre

Examples:

- Alternative Rock
- Electronic
- Art Rock

---

## Initial Relationship Types

### Artist Relationships

- influenced_by
- similar_to
- member_of

### Album Relationships

- created_by
- released_after
- released_before

### Song Relationships

- appears_on
- performed_by
- inspired_by

### Person Relationships

- member_of
- collaborated_with

---

## Proposed Storage Layer

Keep it extremely simple initially.

```text
knowledge/
  artist-radiohead.json
  album-ok-computer.json
  song-paranoid-android.json
```

No graph database required.

No vector database required.

Just durable inspectable files.

---

## Compiler Workflow

### Step 1 — Study Artist

Input:

```text
Study Radiohead
```

Workflow:

```text
collect sources
    ↓
extract entities
    ↓
extract relationships
    ↓
store results
```

---

### Step 2 — Expand Albums

For each discovered album:

```text
album
    ↓
extract songs
    ↓
extract personnel
    ↓
extract relationships
```

---

### Step 3 — Expand Songs

For each discovered song:

```text
song
    ↓
extract metadata
    ↓
extract relationships
```

---

## Example Nerveflow Flow

```nrv
on external "study_artist"

  entities = agent(
    "music_compiler",
    event.value,
    returns={
      entities: [{
        category: "",
        type: "",
        attributes: {},
        relations: []
      }]
    }
  )

  tool("knowledge_store", entities)

end
```

---

## Capability Contracts

Potential host tools:

```text
knowledge_store(entity)
knowledge_get(id)
knowledge_query(filter)
knowledge_relations(id)
knowledge_delete(id)
```

The runtime remains unaware of storage implementation details.

---

## Example Queries

### Album Lookup

```text
Which album contains Paranoid Android?
```

Traversal:

```text
song
    ↓ appears_on
album
```

### Artist Discography

```text
Show all albums by Radiohead
```

Traversal:

```text
artist
    ↓ created_by
albums
```

### Influence Graph

```text
Who influenced Radiohead?
```

Traversal:

```text
artist
    ↓ influenced_by
artist
```

---

## What This Tests

This demo exercises:

- agent contracts
- structured extraction
- tool capabilities
- runtime orchestration
- knowledge persistence
- graph-style reasoning

without introducing new runtime primitives.

---

## Success Criteria

The demo is successful if:

1. Knowledge becomes a durable artifact.
2. Relationships can be traversed without embeddings.
3. The compiler workflow remains inspectable.
4. Existing Nerveflow primitives are sufficient.
5. No DSL changes are required.

---

## Future Extensions

Possible future additions:

- Wikipedia ingestion
- MusicBrainz ingestion
- Discogs ingestion
- Conflict resolution workflows
- Entity reconciliation workflows
- Graph visualization surface
- Hybrid graph + vector retrieval

---

## One-Line Summary

Build a Music Knowledge Compiler that studies artists, albums, songs, and relationships, producing an inspectable knowledge graph artifact orchestrated entirely through existing Nerveflow workflows and host capabilities.
