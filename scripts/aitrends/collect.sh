#!/usr/bin/env bash
# Twice-daily feed collection for the weekly AI report, independent of the Monday weekly.js run.
# Many feeds hold only 1-2 days of items, so a once-a-week fetch misses most of the week.
# Suggested cron (IST): 15 7,19 * * *   (keep clear of the Monday weekly.js slot; SQLite waits 15s on a lock anyway)
# stdout carries alert lines only (cron delivers stdout to WhatsApp); progress goes to $AITRENDS_HOME/last-collect.log.
set -u
export AITRENDS_HOME="${AITRENDS_HOME:-/opt/data/aitrends}"
mkdir -p "$AITRENDS_HOME"
cd /opt/data/scripts/aitrends || { echo "ALERT aitrends: /opt/data/scripts/aitrends missing, collect did not run"; exit 1; }
node --no-warnings collect.js 2>"$AITRENDS_HOME/last-collect.log"
