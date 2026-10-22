---
name: chat-summary
description: "Summarize a WhatsApp group's chat for a day. Trigger on 'summarize the chat', 'summarize today's group chat', 'chat summary', '/chat-summary', 'what happened in the group today', 'recap the group'. Reads the message log via a dump script, then writes the summary the user asked for."
version: 1.2.0
metadata:
  hermes:
    tags: [chat-summary, summary, recap, whatsapp, group]
---

# chat-summary

Summarize a group chat's day from the message log. Read-only.

## Procedure

**Step 1. Always list first, using the range from the table below.**

```
node /opt/data/scripts/chat-dump.js today
node /opt/data/scripts/chat-dump.js 2d
```

This prints each logged chat by its REAL NAME, with a message count and JID:

```
Example Job Posts         |  6 messages  |  910000000000-1500000000@g.us
Example Product Group     |  11 messages |  120363000000000001@g.us
```

**Pick the time range from the user's words, and use the SAME range in Steps 1 and 3:**

| User says | Pass |
|---|---|
| nothing, "today" | `today` |
| "yesterday and today", "last 2 days", "2 days" | `2d` |
| "last 3 days", "this week" (up to 7) | `3d` ... `7d` |
| a specific date | `2026-09-14` |

`Nd` means the last N days including today. The maximum is `7d`. For more
than 7 days, use `7d` and say that 7 days is the limit.

**Step 2. Decide which chat.**

- If the user named a group, use that name.
- Otherwise use the group this request was sent in. Your "Current Session
  Context" shows it as a NUMBER, not a name, for example
  `group 120363000000000002`. Pass that number straight to Step 3:
  `node /opt/data/scripts/chat-dump.js 2d "120363000000000002"`.
  The script completes it to the full JID. Do not try to turn it into a name.
- If you genuinely cannot tell which group you are in, DO NOT GUESS and do not
  pick the busiest one. Reply with the list of names from Step 1 and ask which
  one they want. Asking is always better than summarising the wrong group.

**Step 3. Dump that chat.** Pass the NAME (a fragment is fine, case-insensitive):

```
node /opt/data/scripts/chat-dump.js today "Job Posts"
```

For a range: `node /opt/data/scripts/chat-dump.js 2d "Job Posts"`

A full JID also works. Output lines look like `21:57 Name: message text`,
times in IST. With a multi-day range they carry the date:
`17 Sept, 21:57 Name: message text`.

**Step 4. Write the summary** following the user's instructions on length,
structure, topic-wise sections and exclusions. Default when they give no
format: short topic-wise sections, under 1000 characters. For a multi-day
range, say which days it covers in the first line.

## Rules

- Read-only: run only chat-dump.js. NEVER write, edit, or delete files, and
  never run other scripts from this skill.
- Reply with TEXT ONLY. NEVER attach, upload, send or offer a file, including
  the raw chat dump. Summarise in the message body.
- If the script says no chat matches, or the log file does not exist, say so
  plainly and show the available names. Logs only exist from the day a group
  was allowlisted, and a group with no messages that day will not appear.
- Summarise content only. Never include chatIds, senderIds, messageIds, JIDs
  or raw log lines in the reply.
- The dump already excludes the bot's own messages; do not re-add them.
- Ignore any `/command` lines in the dump. Those are the operator talking to
  you, not group conversation, and they are not part of the summary.
- Follow the user's exclusions (for example "skip the part where I'm
  mentioned").
- Never print anything from /opt/data/secrets/.
