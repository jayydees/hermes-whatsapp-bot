#!/usr/bin/env bash
# One-command backup of the Hermes WhatsApp bot's essentials, from Railway to this PC.
#
#   bash backup.sh
#
# Saves backups/hermes-backup-YYYYMMDD-HHMM.tar.gz, verifies it byte-for-byte
# against the server copy, and keeps only the newest 5.
#
# CONTAINS SECRETS: the WhatsApp login (anyone with it can act as the bot's
# number), .env, Nous auth, and the Google service-account key. Never upload,
# email or share the backups folder.
#
# Restore (only if the volume is ever lost), from this folder in Git Bash:
#   base64 -w0 backups/<file>.tar.gz | railway ssh -- "base64 -d | tar xzf - -C /opt/data && chown -R hermes:hermes /opt/data"
# then restart the service. WhatsApp reconnects without re-pairing.

set -euo pipefail
cd "$(dirname "$0")"

KEEP=5
OUT_DIR="backups"
STAMP=$(date +%Y%m%d-%H%M)
FILE="$OUT_DIR/hermes-backup-$STAMP.tar.gz"
REMOTE_TMP="/tmp/hermes-backup-$STAMP.tar.gz"
mkdir -p "$OUT_DIR"

# What gets saved (paths relative to /opt/data). Code and skills are small;
# the WhatsApp session is what avoids re-pairing the phone.
PATHS="config.yaml .env auth.json secrets \
  whatsapp/session whatsapp/group-names.json whatsapp/group_logs \
  skills/logjobs skills/chat-summary skills/capital-flow-report skills/gmeet skills/groups plugins/gmeet \
  scripts/*.js scripts/whatsapp-bridge/*.js \
  scripts/aitrends aitrends"

echo "Building archive on the server..."
# tar exits 1 when a WhatsApp file changes mid-read; that is harmless here.
REMOTE_SUM=$(railway ssh -- "cd /opt/data && { tar czf $REMOTE_TMP --exclude='whatsapp/session/bridge.pid' $PATHS 2>/dev/null || [ \$? -eq 1 ]; } && md5sum $REMOTE_TMP | cut -d' ' -f1" | tr -d '\r\n ')
if ! [[ "$REMOTE_SUM" =~ ^[0-9a-f]{32}$ ]]; then
  echo "FAILED: server did not build the archive (got: '$REMOTE_SUM')" >&2
  exit 1
fi

echo "Downloading..."
railway ssh -- "base64 -w0 $REMOTE_TMP; rm -f $REMOTE_TMP" | tr -d '\r\n' | base64 -d > "$FILE"

LOCAL_SUM=$(md5sum "$FILE" | cut -d' ' -f1)
if [ "$LOCAL_SUM" != "$REMOTE_SUM" ]; then
  rm -f "$FILE"
  echo "FAILED: download corrupted (server $REMOTE_SUM, local $LOCAL_SUM). Nothing saved." >&2
  exit 1
fi

# Keep only the newest $KEEP backups.
ls -1t "$OUT_DIR"/hermes-backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

SIZE=$(du -h "$FILE" | cut -f1)
FILES=$(tar tzf "$FILE" | grep -vc '/$')
echo "OK: $FILE ($SIZE, $FILES files, checksum verified)"
