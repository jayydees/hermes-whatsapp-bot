---
name: logjobs
description: "Log today's WhatsApp job posts to the Google Sheet. Trigger on any 'logjobs' request (logjobs today, /logjobs today, log jobs, logjobs YYYY-MM-DD). Runs one command and replies with the single line it prints. Never reads logs or classifies jobs itself."
version: 1.2.0
metadata:
  hermes:
    tags: [logjobs, jobs, hiring, whatsapp, sheet, linkedin]
---

# logjobs

Log job posts from the group log to the Google Sheet.
Method: run ONE command, reply with the ONE line it prints. Nothing else.

## Procedure: every invocation, no exceptions

1. Run exactly this, as ONE terminal call:

   ```
   node /opt/data/scripts/logjobs-run.js today
   ```

   If the user gave a date, put that `YYYY-MM-DD` in place of `today`.

2. The command prints one line, for example:

   `Added 5 new jobs from today to the sheet (2 more were already there).`

   Your ENTIRE reply is that line, copied exactly. No greeting, no
   explanation, no JSON, no file names, no row numbers, no follow-up
   question, no emoji you added yourself.

## Hard rules

- The line must come from the command you ran IN THIS TURN. Earlier
  logjobs replies in this chat are stale. Never copy, reuse or predict
  them. If you did not run the command this turn, you have no result, so
  run it.
- If the command prints an error line, reply with that line exactly and
  stop. Do not retry differently or work around it.
- Run the command EXACTLY as written. No env vars, no flags, no path
  changes, no other scripts, no chmod/chown.
- NEVER write, create, edit, copy, or delete any file. The script does all
  writing.
- Reply with TEXT ONLY. NEVER attach, upload, send or offer a file.
- Do not read the JSONL, CSV, or sidecar yourself. Do not touch the Sheet
  directly. Do not classify jobs.
- Never print /opt/data/secrets/google-sa.json, JWTs, or key material.
