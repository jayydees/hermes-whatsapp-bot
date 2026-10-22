// AI report collector. Runs twice a day via collect.sh (many feeds hold only 1-2 days of items) and once more
// inside weekly.js before writing. Re-running is safe: items and deals are keyed by item id, and the week
// filter uses each item's first known published date (else first_seen), so nothing is counted twice.
// Silent on stdout unless something needs the operator's attention
// (cron delivers stdout to WhatsApp). Progress goes to stderr.
//   node collect.js [--dry]
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { FEEDS } = require("./feeds");
const { parseFeed } = require("./lib/rss");
const { open, upsertItem, upsertDeal, recordRun } = require("./lib/db");
const { parseDeal, isAI } = require("./lib/money");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TIMEOUT_MS = 30000;
const FUNDING_WORDS = /\b(raises?|raised|bags|secures?|lands|nets|funding|series [a-k]|seed)\b/i;

async function fetchXml(feed, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(feed.url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const safeName = (n) => n.replace(/[\\/:*?"<>|]+/g, "_");

// Returns { alerts, allFailed, counts }; prints nothing to stdout.
async function runCollect({ feeds = FEEDS, fetchImpl = fetch, now = new Date(), home, dry = false, log = () => {} } = {}) {
  home = home || process.env.AITRENDS_HOME || "/opt/data/aitrends";
  const runAt = now.toISOString();
  const day = runAt.slice(0, 10);

  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const xml = await fetchXml(feed, fetchImpl);
        const items = parseFeed(xml, feed);
        if (!items.length) return { feed, xml, items, error: "parsed 0 items" };
        return { feed, xml, items };
      } catch (e) {
        return { feed, items: [], error: String((e && e.message) || e) };
      }
    })
  );

  const counts = results.map((r) => `${r.feed.name}: ${r.error ? "FAILED (" + r.error + ")" : r.items.length + " items"}`);
  const ok = results.filter((r) => !r.error);
  const allFailed = results.length > 0 && ok.length === 0;

  const alerts = [];
  if (results.length && ok.length / results.length < 0.6) {
    const bad = results.filter((r) => r.error).map((r) => r.feed.name);
    alerts.push(`ALERT aitrends: only ${ok.length}/${results.length} feeds succeeded (failed: ${bad.join(", ")})`);
  }
  for (const section of new Set(feeds.map((f) => f.section_hint))) {
    const inSection = results.filter((r) => r.feed.section_hint === section);
    if (!inSection.some((r) => !r.error)) alerts.push(`ALERT aitrends: no feed succeeded for section ${section}`);
  }

  if (dry) {
    log(counts.join("\n"));
    return { alerts, allFailed, counts };
  }

  const db = open(path.join(home, "aitrends.db"));
  const rawDir = path.join(home, "raw", day);
  fs.mkdirSync(rawDir, { recursive: true });
  let deals = 0;
  const effectiveDate = db.prepare("SELECT COALESCE(published, first_seen) d FROM items WHERE id = ?");
  for (const r of results) {
    if (r.xml) fs.writeFileSync(path.join(rawDir, safeName(r.feed.name) + ".xml.gz"), zlib.gzipSync(r.xml));
    db.exec("BEGIN");
    for (const it of r.items) {
      upsertItem(db, { ...it, first_seen: runAt });
      if (r.feed.section_hint === "money" || FUNDING_WORDS.test(it.title)) {
        const d = parseDeal(it.title, it.summary);
        if (d && isAI(it.title, it.summary)) {
          // The deal's date is the item's stored date (first published, else first_seen), so a re-collected
          // undated item keeps its week instead of moving to "now" and being counted again next week.
          const published = effectiveDate.get(it.id).d;
          upsertDeal(db, { item_id: it.id, company: d.company, amount_usd: d.amount_usd, round: d.round, published, title: it.title });
          deals++;
        }
      }
    }
    recordRun(db, { run_at: runAt, feed: r.feed.name, ok: !r.error, items: r.items.length, error: r.error || null });
    db.exec("COMMIT");
  }
  db.close();
  log(counts.join("\n") + `\ndeals extracted: ${deals}`);
  return { alerts, allFailed, counts };
}

if (require.main === module) {
  const dry = process.argv.includes("--dry");
  runCollect({ dry, log: (m) => process.stderr.write(m + "\n") })
    .then(({ alerts, allFailed }) => {
      if (alerts.length) console.log(alerts.join(" | "));
      process.exit(allFailed ? 1 : 0);
    })
    .catch((e) => {
      console.log("ALERT aitrends: collect crashed (" + ((e && e.message) || e) + ")");
      process.exit(1);
    });
}

module.exports = { runCollect };
