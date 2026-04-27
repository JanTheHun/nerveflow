Classify all provided news articles for alert priority.

Return JSON matching the contract.

Output constraints:
- Output must be a single raw JSON object only.
- Do not include markdown, code fences, comments, or explanation text.
- Keep output compact and valid JSON (double-quoted keys/strings, no trailing commas).

Rules:
- Return one classification object per input article id.
- Preserve each article id exactly as provided.
- Use "urgent" only when immediate user attention is warranted.
- Use favorite topics as a strong signal for urgency/high priority.
- If an article is irrelevant or low-value, use "ignore".
- Keep reason short and concrete (max 12 words).