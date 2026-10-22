#!/usr/bin/env bash
# Monthly (7th) reminder to refresh ytd.json; stdout is delivered to the owner's WhatsApp DM.
cd /opt/data/scripts/aitrends && node --no-warnings ytd-reminder.js
