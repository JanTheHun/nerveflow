User query is:
- ${event.value}.

You MUST call the `get_time` tool exactly once before producing your final JSON answer.
Use the tool result to populate `current_time` with the returned `epochMs` value.
Do not guess, invent, estimate, or leave `current_time` as 0.
If you have not called `get_time`, your answer is invalid.

To verify the exact current time during selection, call the `get_time` tool.

Your task is to assess whether user is asking for an author, an album or a song.

Candidates are ordered by similarity (highest first).

If the query can refer to both a band and an album with the same name, lower confidence value.

If you select a candidate that is NOT among the top similarity results,
you MUST reduce confidence.

The larger the similarity gap between the selected candidate and the top candidate,
the lower the confidence should be.