/**
 * Shared group-name resolver.
 *
 * The message logger stores chatName as the bare JID digits, so real names must
 * come from the bridge. But a single dropped bridge lookup used to leave a group
 * nameless, which silently broke name matching in /groups and /chat-summary.
 *
 * Strategy: ask the bridge, and remember every answer. If the bridge fails,
 * fall back to the last known name rather than losing it.
 */

const fs = require("fs");

const CACHE_PATH =
  process.env.GROUP_NAME_CACHE || "/opt/data/whatsapp/group-names.json";
const BRIDGE = process.env.WA_BRIDGE || "http://localhost:3000";

function loadCache() {
  try {
    const d = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
    return d && typeof d === "object" ? d : {};
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // Non-fatal: a read-only cache still serves previously stored names.
  }
}

async function fetchName(jid, attempt = 0) {
  try {
    const r = await fetch(BRIDGE + "/chat/" + jid, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    const nm = j && j.name ? String(j.name) : "";
    // The bridge echoes the JID digits when it has no real name.
    return nm && nm !== jid.split("@")[0] ? nm : "";
  } catch {
    if (attempt < 1) return fetchName(jid, attempt + 1);
    return "";
  }
}

/**
 * Resolve names for a list of JIDs.
 * Returns { jid: name }, where name is "" only if the bridge failed AND the
 * group has never been seen before.
 */
async function resolveNames(jids) {
  const cache = loadCache();
  const live = await Promise.all(jids.map((j) => fetchName(j)));

  const out = {};
  let changed = false;
  jids.forEach((jid, i) => {
    if (live[i]) {
      out[jid] = live[i];
      if (cache[jid] !== live[i]) {
        cache[jid] = live[i];
        changed = true;
      }
    } else {
      out[jid] = cache[jid] || ""; // bridge hiccup: use last known name
    }
  });

  if (changed) saveCache(cache);
  return out;
}

/** Participant counts are live-only; absence is not worth caching. */
async function participantCount(jid) {
  try {
    const r = await fetch(BRIDGE + "/chat/" + jid, {
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return j && Array.isArray(j.participants) ? j.participants.length : 0;
  } catch {
    return 0;
  }
}

module.exports = { resolveNames, participantCount, CACHE_PATH };
