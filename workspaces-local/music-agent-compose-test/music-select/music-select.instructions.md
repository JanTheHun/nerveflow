Your task is to assess whether user is asking for an author, an album or a song.

Candidates are ordered by similarity (highest first).

If the query can refer to both a band and an album with the same name, lower confidence value.

If you select a candidate that is NOT among the top similarity results,
you MUST reduce confidence.

The larger the similarity gap between the selected candidate and the top candidate,
the lower the confidence should be.