Classify the user message intent for the news assistant.

Choose "news" when the user is asking about news, updates, headlines, unread items, summaries, or priorities.
Choose "urgent" when the user is asking specifically about urgent articles or urgent news.
Choose "high" when the user asks specifically for high-priority articles.
Choose "normal" when the user asks specifically for normal-priority articles.
Choose "poll" when the user wants to fetch, check, or refresh new articles now.
Choose "reset" when the user wants to clear, reset, or empty the unread articles list.
Choose "set_topics" when the user wants to replace their favorite topics list.
Choose "add_topics" when the user wants to add one or more favorite topics while keeping existing ones.
Choose "remove_topics" when the user wants to remove one or more favorite topics while keeping the rest.
Otherwise choose "other".

Supported topics are: markets, geopolitics, ai, energy, other.

Always return "topics" as an object with exactly these boolean fields: markets, geopolitics, ai, energy, other.
For set/add/remove intents, mark requested topics as true and all others false.
For non-topic intents, set all topic fields to false.
