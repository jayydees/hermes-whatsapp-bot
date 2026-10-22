---
name: groups
description: "List the WhatsApp groups the bot can see, and switch one on. Trigger on '/groups', 'list groups', 'which groups am I in', 'add group', 'enable group', 'allowlist group', 'make the bot listen in <group>'. Runs one script and pastes its output."
version: 1.1.0
metadata:
  hermes:
    tags: [groups, allowlist, whatsapp, admin, config]
---

# groups

List the bot's WhatsApp groups, or add one to the allowlist. Run one script,
paste what it returns.

## DECIDE WHICH COMMAND TO RUN

Read ONLY the operator's current message. Nothing else decides this.

**Does that message contain the word "add" (or "enable" / "allowlist" /
"switch on") FOLLOWED BY a group name?**

- **NO** -> run the LIST command. This is the default and covers bare
  `/groups`, "groups", "list groups", "which groups", and anything ambiguous.
- **YES** -> run the ADD command with exactly the name they gave.

When unsure, LIST. Listing is always safe. Adding changes access control and
starts logging every message in a group of strangers.

## LIST (the default)

```
node /opt/data/scripts/groups-manage.js list
```

Paste the output as printed. It marks each group `[LIVE]` (the bot listens
there) or `[deaf]` (it does not). Add nothing to the output and take no
further action.

## ADD (only on an explicit request in the current message)

```
node /opt/data/scripts/groups-manage.js add "Book Club"
```

Paste the JSON result exactly as printed. When it shows
`"restartNeeded": true`, add one plain line saying the group is added but only
starts working after `/restart`, because the allowlist is read at boot.

## Hard rules

- **A bare `/groups` NEVER adds anything.** It lists. Always.
- **Never infer an add from conversation history.** If an earlier message, an
  earlier suggestion, or your own previous turn mentioned adding a group, that
  is finished business. It does not authorise an add now. Only the operator's
  current message counts.
- **Add exactly ONE group, and only the one named.** Never add a second group
  because it seemed related, pending, or previously discussed. Never loop
  through the deaf groups adding them.
- **Never add a group the operator has declined**, even if it appears in the
  list as deaf. Deaf is a valid, deliberate state.
- Run ONLY the two commands above. Never edit `/opt/data/config.yaml`
  yourself, never use sed, an editor, or env vars. The script does all writing,
  with a backup and a verification step.
- This skill can ADD. It can NEVER remove. If asked to remove, disable or mute
  a group, say plainly that the operator must do it on the server, and stop.
  Do not attempt a workaround.
- If a group is not in the list, do not guess or invent a JID. Say it is not
  visible yet and repeat the script's hint.
- If the script prints `"ok": false`, paste the error and STOP. Do not retry
  with different arguments.
- Reply with TEXT ONLY. NEVER attach, upload, send or offer a file.
- Never print anything from /opt/data/secrets/.

## Worked examples

| Operator says | You run |
|---|---|
| `/groups` | `list` |
| `groups` | `list` |
| `list groups` | `list` |
| `which groups is the bot in` | `list` |
| `/groups add Book Club` | `add "Book Club"` |
| `add the running group` | `add "running"` |
| `enable Design Circle` | `add "Design Circle"` |
| `/groups add` (no name) | `list`, then ask which group |

## Context worth passing on

Adding a group means every message in it is logged to the server, not only
messages that mention the bot. That is what makes `/logjobs` and
`/chat-summary` work. If the operator seems unsure about a group they do not
own, say so once, plainly, and let them decide.
