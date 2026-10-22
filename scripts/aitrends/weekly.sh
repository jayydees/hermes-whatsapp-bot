#!/usr/bin/env bash
# Monday 05:00 IST: final collect, then write last week's report with Gemini.
# stdout carries alert lines only (cron delivers stdout to WhatsApp); progress goes to $AITRENDS_HOME/last-weekly.log.
set -u
export AITRENDS_HOME="${AITRENDS_HOME:-/opt/data/aitrends}"
mkdir -p "$AITRENDS_HOME"
cd /opt/data/scripts/aitrends || { echo "ALERT aitrends: /opt/data/scripts/aitrends missing, weekly report did not run"; exit 1; }
node --no-warnings weekly.js 2>"$AITRENDS_HOME/last-weekly.log"
