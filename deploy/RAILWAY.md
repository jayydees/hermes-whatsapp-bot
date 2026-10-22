# Deploying on Railway

These are the steps and settings this bot ran with. Hermes itself changes
often, so check the [Hermes Agent docs](https://github.com/NousResearch/hermes-agent)
for anything about Hermes's own setup commands.

## Service

| Setting | Value used |
|---|---|
| Image | `nousresearch/hermes-agent` (first deployed on tag `v2026.9.7`; pin a tag) |
| Start command | `/bin/sh -c "exec hermes gateway run --no-supervise"` |
| Volume | mounted at `/opt/data` (Hermes home: config, .env, sessions, skills, scripts, logs) |
| Restart policy | **Always**. With "On failure" Railway stops relaunching after 10 exits per deployment, and every `/restart` counts as one exit. |
| Size | about 460 MB RAM in practice (gateway about 265 MB, bridge about 100 MB). Roughly $5 a month on the Hobby plan. |

The service cannot sleep or scale to zero. WhatsApp needs a socket that stays
open.

## First setup

1. Create the service from the image with the volume and start command above.
2. Run Hermes's setup on the server to create `/opt/data/config.yaml` and
   `/opt/data/.env`, then pair WhatsApp. Pairing links the bot as a "linked
   device" on an existing WhatsApp number, the same way WhatsApp Web does.
   The login is stored under `/opt/data/whatsapp/session/`. Anyone holding
   those files can act as that number.
3. Merge `config/config.example.yaml` into `/opt/data/config.yaml`.
4. Fill `/opt/data/.env` using `.env.example` for the names.
5. Copy the repo folders onto the volume, keeping the same layout:

   | Repo | Server |
   |---|---|
   | `skills/<name>/SKILL.md` | `/opt/data/skills/<name>/SKILL.md` |
   | `scripts/*` | `/opt/data/scripts/` |
   | `plugins/gmeet/` | `/opt/data/plugins/gmeet/` |

6. Apply `patches/bridge-group-log.md` if you want `/logjobs` and
   `/chat-summary`. Read its privacy warning first.
7. Put credentials in `/opt/data/secrets/` with mode 600:
   - `google-sa.json`: a Google service account with edit access to the target Sheet (`/logjobs`)
   - `gmeet-token.json`: written on your own computer by `node tools/gmeet-auth.js` (`/gmeet`)
8. Restart the service.

## Copying files to the server

`railway ssh` closes after each command, and long command-line arguments get
cut off without an error. Stream files through stdin instead:

```bash
base64 -w0 scripts/logjobs-run.js | railway ssh -- "base64 -d > /opt/data/scripts/logjobs-run.js && chown hermes:hermes /opt/data/scripts/logjobs-run.js"
```

For big files, compare `md5sum` on both ends before using them. Large uploads
over this path have dropped data silently.

`railway ssh` runs as root. Anything root creates must be handed back with
`chown hermes:hermes`, or the bot later fails with permission errors and may
try to work around them on its own.

## Applying changes

| You changed | Do this |
|---|---|
| Text inside a SKILL.md | Nothing. Skill text is read fresh on each use. |
| A SKILL.md `name:` or other frontmatter | Send `/reload-skills` in the chat |
| `config.yaml` (allowlist, model, compression, quick commands, plugins) | Restart: `/restart` in chat, or restart the service |
| A plugin | Restart |

## Scheduled jobs

The data commands rely on Hermes cron jobs that run a shell script with no
model involved and send the script's output (alerts only) to the owner's
WhatsApp DM. Schedules used, in UTC:

| Job | Script | Schedule |
|---|---|---|
| aitrends collect | `scripts/aitrends/collect.sh` | daily 01:45 and 13:45 |
| aitrends weekly | `scripts/aitrends/weekly.sh` | Sunday 23:30 |
| aitrends reminder | `scripts/aitrends/ytd-reminder.sh` | 7th of the month 04:00 |

Hermes caps a cron script at 3600 seconds, so keep each job short. Create the jobs with Hermes's cron
feature; check its docs for the exact command.

## Backups

`deploy/backup.sh` (Git Bash or any bash with the Railway CLI logged in)
builds a tar of the important paths on the server, streams it down, checks the
md5 against the server copy, and keeps the newest 5. The restore one-liner is
in the script header.

The archive holds every secret the bot has: the WhatsApp login, `.env`,
provider auth, the Google keys and all logged group messages. Store it like a
password. Do not sync it to a shared drive or commit it.

## Recovering a lost Nous login

If you use Nous Portal as a provider: when its OAuth refresh session is
revoked, Hermes logs `invalid_grant` / "Refresh session has been revoked" and
every reply fails. The fix needs an interactive terminal. Run `railway ssh`
with no command, run `hermes model`, and approve the device code in a browser.
Then `chown hermes:hermes /opt/data/auth.json && chmod 600 /opt/data/auth.json`.
`railway ssh -- "<command>"` cannot do this because the login flow refuses to
run without a TTY.

Running Hermes's setup wizard again can reset `model.default`. Check the model
after any setup run.
