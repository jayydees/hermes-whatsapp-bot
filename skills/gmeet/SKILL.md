---
name: gmeet
description: "Fallback only. /gmeet is handled by the gmeet plugin, not by the model. Trigger on '/gmeet', 'create a meet link', 'google meet link', 'need a meeting link'."
version: 2.0.0
metadata:
  hermes:
    tags: [gmeet, meet, google-meet, meeting, link]
---

# gmeet

Meet links are made only by the gmeet plugin. If you are reading this, the plugin did not handle the request.

Reply with exactly this line and nothing else:

/gmeet is unavailable right now (the plugin did not load). Ask the bot owner to check the bot.

## Hard rules

- Never write, guess, or reuse a meet.google.com link.
- Never run scripts, call Google, or read /opt/data/secrets/.
