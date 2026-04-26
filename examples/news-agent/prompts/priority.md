Classify a single news article for alert priority.

Return JSON matching the contract.

Rules:
- Use "urgent" only when immediate user attention is warranted.
- Use favorite topics as a strong signal for urgency/high priority.
- If article is irrelevant or low-value, use "ignore".
- Keep reason short and concrete.
