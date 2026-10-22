#!/usr/bin/env node
/**
 * List WhatsApp groups the bot can see, and add one to the allowlist.
 *
 *   node groups-manage.js list
 *   node groups-manage.js add <jid-or-name-fragment>
 *
 * ADD-ONLY by design: this script can never remove a group from the allowlist,
 * so a bad instruction cannot quietly make the bot deaf. Removals stay manual.
 * Adding takes effect only after a gateway restart.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CONFIG = process.env.HERMES_CONFIG || "/opt/data/config.yaml";
const SESSION_DIR =
  process.env.WA_SESSION_DIR || "/opt/data/whatsapp/session";
const LOG_DIR = process.env.GROUP_LOG_DIR || "/opt/data/whatsapp/group_logs";
const BRIDGE = process.env.WA_BRIDGE || "http://localhost:3000";

function out(o) {
  console.log(JSON.stringify(o));
}

// Group JIDs come in TWO formats:
//   modern  120363xxxxxxxxxxxx@g.us
//   legacy  <creator-phone>-<timestamp>@g.us   (older groups)
// Matching only the modern form hides legacy groups completely.
const JID_RE = /((?:120363\d+|\d{6,}-\d{6,})@g\.us)/;
const JID_RE_G = new RegExp(JID_RE.source, "g");
const JID_RE_FULL = new RegExp("^" + JID_RE.source + "$");

/** Every group JID the bot has crypto state, a hydration record, or a logged message for. */
function discoverJids() {
  const jids = new Set();
  // 1. Session filenames (sender keys)
  try {
    for (const f of fs.readdirSync(SESSION_DIR)) {
      const m = f.match(JID_RE);
      if (m) jids.add(m[1]);
    }
  } catch {}
  // 2. Hydration snapshot (authoritative at connect time)
  try {
    const dbg = fs.readFileSync(path.join(SESSION_DIR, "groups-debug.json"), "utf8");
    for (const m of dbg.matchAll(JID_RE_G)) jids.add(m[1]);
  } catch {}
  // 3. Message logs. The bridge logs every group message it receives, so this
  //    catches groups the other two sources miss entirely.
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.endsWith(".jsonl")) continue;
      const txt = fs.readFileSync(path.join(LOG_DIR, f), "utf8");
      for (const m of txt.matchAll(JID_RE_G)) jids.add(m[1]);
    }
  } catch {}
  return [...jids].sort();
}

const { resolveNames, participantCount } = require("/opt/data/scripts/group-names.js");

function readAllow() {
  const raw = fs.readFileSync(CONFIG, "utf8");
  // group_allow_from may sit on its own line or wrap onto the next one.
  const m = raw.match(/group_allow_from:[ \t]*\n?([^\n]*)/);
  if (!m) return { raw, line: "", ids: [] };
  const ids = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => JID_RE_FULL.test(s));
  return { raw, ids };
}

(async () => {
  const cmd = (process.argv[2] || "list").toLowerCase();
  const arg = (process.argv[3] || "").trim();

  const jids = discoverJids();
  const allow = readAllow();
  const allowSet = new Set(allow.ids);

  // Names come from the shared resolver: live bridge lookups in parallel, with
  // a cache fallback so one dropped lookup cannot make a group unmatchable.
  const names = await resolveNames(jids);
  const counts = await Promise.all(jids.map((j) => participantCount(j)));
  const rows = jids.map((j, i) => ({
    jid: j,
    name: names[j] || "",
    participants: counts[i],
    live: allowSet.has(j),
    reachable: Boolean(names[j]),
  }));

  if (cmd === "list") {
    // Count logged messages per group. A group with zero logged messages will
    // fail /chat-summary and /logjobs even when it is allowlisted, so surface
    // that before the operator finds out in front of 500 people.
    const logged = {};
    try {
      for (const f of fs.readdirSync(LOG_DIR)) {
        if (!f.endsWith(".jsonl")) continue;
        const txt = fs.readFileSync(path.join(LOG_DIR, f), "utf8");
        for (const m of txt.matchAll(JID_RE_G)) logged[m[1]] = (logged[m[1]] || 0) + 1;
      }
    } catch {}

    console.log("GROUPS (" + rows.length + " visible, " + allow.ids.length + " allowlisted)");
    console.log("");
    for (const r of rows) {
      const n = logged[r.jid] || 0;
      const ready = r.live && n > 0;
      const flag = ready ? "[READY]   " : r.live ? "[LIVE*]   " : "[deaf]    ";
      const nm = r.name || "(no metadata, bot likely not a member)";
      console.log(flag + nm);
      console.log(
        "          " + r.jid +
        (r.participants ? "  (" + r.participants + " members)" : "") +
        "  " + n + " msgs logged"
      );
    }
    console.log("");
    console.log("[READY] = allowlisted AND messages logged. Commands will work here.");
    console.log("[LIVE*] = allowlisted but nothing logged yet. Post a message in it first.");
    console.log("[deaf]  = not allowlisted. Use: /groups add <name fragment>");
    return;
  }

  if (cmd !== "add") {
    out({ ok: false, error: "unknown command '" + cmd + "'. Use list or add." });
    process.exit(1);
  }

  if (!arg) {
    out({ ok: false, error: "no group given. Usage: groups-manage.js add <jid or name fragment>" });
    process.exit(1);
  }

  // Match by exact JID first, then by case-insensitive name fragment.
  let matches = rows.filter((r) => r.jid === arg);
  if (!matches.length) {
    const q = arg.toLowerCase();
    matches = rows.filter((r) => r.name && r.name.toLowerCase().includes(q));
  }

  if (!matches.length) {
    out({
      ok: false,
      error: "no group matches '" + arg + "'",
      hint:
        "The bridge only learns a group exists at connect time, or when a message " +
        "arrives from it. If the bot was added recently: run /restart (refreshes the " +
        "full group list from WhatsApp), or have someone post a message in that group. " +
        "Then retry.",
    });
    process.exit(1);
  }
  if (matches.length > 1) {
    out({
      ok: false,
      error: "'" + arg + "' matches " + matches.length + " groups; be more specific or pass the JID",
      matches: matches.map((m) => ({ name: m.name, jid: m.jid })),
    });
    process.exit(1);
  }

  const g = matches[0];
  if (g.live) {
    out({ ok: true, alreadyEnabled: true, name: g.name, jid: g.jid, restartNeeded: false });
    return;
  }

  const backup = CONFIG + ".bak-groups-" + Date.now();
  fs.copyFileSync(CONFIG, backup);

  const current = allow.ids.join(",");
  if (!current) {
    out({ ok: false, error: "could not parse existing group_allow_from; refusing to write" });
    process.exit(1);
  }
  const updated = current + "," + g.jid;
  const next = allow.raw.replace(current, updated);
  if (next === allow.raw) {
    out({ ok: false, error: "allowlist text not found for replacement; refusing to write" });
    process.exit(1);
  }
  fs.writeFileSync(CONFIG, next);

  try {
    execSync("chown hermes:hermes " + CONFIG + " && chmod 644 " + CONFIG);
  } catch {}

  const verify = readAllow();
  if (!verify.ids.includes(g.jid)) {
    fs.copyFileSync(backup, CONFIG);
    out({ ok: false, error: "verification failed, config restored from backup" });
    process.exit(1);
  }

  out({
    ok: true,
    added: g.name,
    jid: g.jid,
    totalGroups: verify.ids.length,
    backup,
    restartNeeded: true,
    note: "Run /restart to load it. The allowlist is only read at boot.",
  });
})();
