#!/usr/bin/env node
/**
 * Dump group-chat messages from the daily JSONL logs as clean readable lines.
 * Usage:
 *   node chat-dump.js [today|YYYY-MM-DD|Nd]            -> list chats seen (chatId, name, count)
 *   node chat-dump.js [today|YYYY-MM-DD|Nd] <chatId>   -> print that chat's messages: "HH:MM name: body"
 * Nd = the last N days including today (2d = yesterday + today), up to 7d.
 * Read-only. Skips the bot's own messages (fromMe) and empty bodies.
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.GROUP_LOG_DIR || "/opt/data/whatsapp/group_logs";
const MAX_MSGS = 500; // keep output model-sized; oldest trimmed first
const MAX_DAYS = 7;

// The logger stores chatName as the bare JID digits, which is useless for
// matching. The shared resolver gets real names from the bridge, with a cache
// fallback so a transient bridge failure cannot break name matching.
const { resolveNames } = require("/opt/data/scripts/group-names.js");

function daysArg(a) {
  a = (a || "today").trim().toLowerCase();
  if (a === "today" || a === "") return [new Date().toISOString().slice(0, 10)];
  const m = a.match(/^(\d+)d$/);
  if (m) {
    const n = Number(m[1]);
    if (n < 1 || n > MAX_DAYS) {
      console.error("range must be 1d to " + MAX_DAYS + "d, got " + a);
      process.exit(1);
    }
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    }
    return out;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    console.error("bad day: " + a);
    process.exit(1);
  }
  return [a];
}

const rangeArg = (process.argv[2] || "today").trim();
const days = daysArg(rangeArg);
const multiDay = days.length > 1;
const label = multiDay ? days[0] + " to " + days[days.length - 1] : days[0];
let chatArg = (process.argv[3] || "").trim();
// Hermes shows the current WhatsApp group to the model as its bare ID number
// (e.g. "120363000000000002"), so accept that and complete the JID.
if (/^\d+(-\d+)?$/.test(chatArg)) chatArg += "@g.us";

const files = days
  .map((d) => path.join(LOG_DIR, d + ".jsonl"))
  .filter((f) => fs.existsSync(f));

if (!files.length) {
  console.log("No log file for " + label + " in " + LOG_DIR + ". Logs exist only from the day a group was allowlisted.");
  process.exit(0);
}

const recs = files
  .flatMap((f) => fs.readFileSync(f, "utf8").split("\n"))
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.body && !(r.fromMe === true || r.fromMe === "true"));

const byChat = {};
for (const r of recs) {
  const k = r.chatId || "?";
  byChat[k] = byChat[k] || { count: 0 };
  byChat[k].count++;
}
const chatIds = Object.keys(byChat);

(async () => {
  const nameOfJid = await resolveNames(chatIds);

  if (!chatArg) {
    console.log("Chats logged on " + label + ":");
    for (const id of chatIds) {
      console.log(
        (nameOfJid[id] || "(name unavailable)") +
          "  |  " + byChat[id].count + " messages  |  " + id
      );
    }
    console.log("\nTo summarise one: chat-dump.js " + rangeArg + ' "<name or JID>"');
    return;
  }

  // Exact JID first, then case-insensitive name fragment.
  let target = chatIds.includes(chatArg) ? chatArg : null;
  if (!target) {
    const q = chatArg.toLowerCase();
    const hits = chatIds.filter(
      (j) => nameOfJid[j] && nameOfJid[j].toLowerCase().includes(q)
    );
    if (hits.length === 1) target = hits[0];
    else if (hits.length > 1) {
      console.log("'" + chatArg + "' matches " + hits.length + " chats. Be more specific:");
      for (const h of hits) console.log("  " + nameOfJid[h] + "  |  " + h);
      return;
    }
  }
  if (!target) {
    console.log(
      "No chat matches '" + chatArg + "' in the log for " + label + ". Chats available:"
    );
    for (const id of chatIds) {
      console.log("  " + (nameOfJid[id] || "(name unavailable)") + "  |  " + id);
    }
    return;
  }

  dump(target, nameOfJid[target] || target);
})();

function dump(target, name) {
let msgs = recs.filter((r) => (r.chatId || "") === target);
msgs.sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0));
const total = msgs.length;
if (msgs.length > MAX_MSGS) msgs = msgs.slice(-MAX_MSGS);

function stamp(ts) {
  if (!ts) return "??:??";
  const opts = {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  };
  if (multiDay) {
    opts.day = "2-digit";
    opts.month = "short";
  }
  return new Date(Number(ts) * 1000).toLocaleString("en-IN", opts);
}

console.log(
  name + " on " + label + " — " + total + " messages" +
  (total > MAX_MSGS ? " (showing last " + MAX_MSGS + ")" : "") + ":"
);
for (const r of msgs) {
  const body = String(r.body).replace(/\s+/g, " ").trim().slice(0, 500);
  console.log(stamp(r.ts) + " " + (r.pushName || "someone") + ": " + body);
}
}
