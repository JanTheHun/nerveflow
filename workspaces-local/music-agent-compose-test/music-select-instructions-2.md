# User query:
**${event.value}**

### Candidates:
- Provided as a list, ordered by similarity (highest first).
- Each candidate has a unique "id" field.
- You MUST choose one of these ids.

### Task:
Select the most likely target type ("author", "album", or "song"),
select the best matching candidate by its "id",
and assign confidence based on similarity and semantic match.

### Rules:

1. Valid selection:
   You MUST choose an id that exists in the candidates list.
   If there is only one candidate, you MUST select its id.

2. Similarity is the primary signal:
   Prefer top candidates unless there is a strong semantic reason not to.

3. Ambiguity handling:
   If top candidates have very similar similarity (difference < ~0.05)
   and different types, treat as ambiguous:
   - avoid high confidence (>0.8)
   - confidence should be moderate or low

4. Same-name ambiguity:
   If the query can refer to both a band and an album with the same name,
   do NOT assign high confidence to a single type.

5. Song bias:
   If a top candidate is a song, prefer "song".
   If no top candidates are songs, keep song confidence low.

6. Semantic override:
   You MAY choose a lower-ranked candidate if it is a clearly better semantic match.

   In this case:
   - you MUST reduce confidence
   - larger similarity gap → lower confidence

7. Strong keyword match:
   If a lower-ranked candidate contains a distinctive keyword from the query
   (e.g. "stupid" → "Stupid Girl"),
   you MAY prefer it over higher-ranked generic matches.

   Confidence should be moderate (0.5–0.7).

8. Confidence scale:
   - 0.9–1.0 → clear top match
   - 0.6–0.8 → reasonable
   - 0.3–0.6 → ambiguous or indirect
   - <0.3 → unlikely

9. Uncertainty rule:
   If unsure, prefer lower confidence over guessing.

## Output:
### Return:
- type: "author" | "album" | "song"
- id: selected candidate id (must match one of the inputs exactly)
- confidence: number between 0 and 1