#!/usr/bin/env node
/**
 * Fetch a week's funding news from RSS feeds and print a compact digest.
 * Usage: node capital-flow-fetch.js [isoWeek]   (default: current ISO week)
 *
 * Deterministic. No model involved. The model reads this digest and writes the
 * report in ONE call, instead of making a dozen search/fetch calls itself.
 */

const FEEDS = [
  { url: "https://indianstartupnews.com/rss", region: "INDIA", name: "IndianStartupNews" },
  { url: "https://entrackr.com/rss", region: "INDIA", name: "Entrackr" },
  { url: "https://inc42.com/feed", region: "INDIA", name: "Inc42" },
  { url: "https://techcrunch.com/feed/", region: "US", name: "TechCrunch" },
  {
    url:
      "https://news.google.com/rss/search?q=startup+raises+funding+round+when:7d&hl=en-US&gl=US&ceid=US:en",
    region: "US",
    name: "GoogleNews",
  },
];

// A real funding item needs a MONEY AMOUNT OF SIZE, or a named round.
// Loose keyword matching let "a raise of $1 per hour" and conference posts in.
const MONEY_RE =
  /\$\s?\d+(\.\d+)?\s?(m|bn|b|million|billion)\b|\bRs\.?\s?\d+(\.\d+)?\s?(cr|crore|lakh|million|billion)?\b|\b\d+(\.\d+)?\s?(million|billion|crore|lakh)\b/i;
const ROUND_RE =
  /\bseries\s+[a-j]\b|\bseed\b|\bpre-seed\b|\bfunding\b|\braises?\b|\braised\b|\bacqui(res|red|sition)\b|\bvaluation\b|\bIPO\b|\bSPAC\b/i;
const MAX_PER_FEED = 25;
const MAX_TOTAL = 60;
const TIMEOUT_MS = 15000;

function pad(n) {
  return String(n).padStart(2, "0");
}
function ymd(d) {
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}
function monD(d) {
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return m[d.getUTCMonth()] + " " + d.getUTCDate();
}

// ISO week: week 1 is the week containing Jan 4; weeks start Monday.
function isoWeekOf(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  return { year: t.getUTCFullYear(), week: 1 + Math.round((t - firstThu) / 604800000) };
}
function weekRange(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = (jan4.getUTCDay() + 6) % 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - day + (week - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 999);
  return [mon, sun];
}

function decode(s) {
  // Unescape entities BEFORE stripping tags: feeds escape their HTML, so
  // stripping first would leave `&lt;a href=...&gt;` to resurface as markup.
  let out = String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  for (let i = 0; i < 2; i++) {
    out = out
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/<[^>]+>/g, " ");
  }
  return out
    .replace(/https?:\/\/\S+/g, "") // drop bare tracking URLs (Google News)
    .replace(/\s+/g, " ")
    .trim();
}
function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? decode(m[1]) : "";
}

async function fetchFeed(f) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(f.url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; capital-flow/1.0)" },
    });
    if (!r.ok) return { ...f, error: "HTTP " + r.status, items: [] };
    const xml = await r.text();
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const items = blocks.slice(0, MAX_PER_FEED).map((b) => ({
      title: tag(b, "title"),
      link: tag(b, "link"),
      date: tag(b, "pubDate"),
      desc: tag(b, "description").slice(0, 220),
    }));
    return { ...f, items };
  } catch (e) {
    return { ...f, error: String(e.message || e), items: [] };
  } finally {
    clearTimeout(t);
  }
}

(async () => {
  const now = new Date();
  const cur = isoWeekOf(now);
  const week = parseInt(process.argv[2] || "", 10) || cur.week;
  const year = cur.year;
  const [start, end] = weekRange(year, week);

  const results = await Promise.all(FEEDS.map(fetchFeed));

  const seen = new Set();
  const kept = { INDIA: [], US: [] };
  let scanned = 0;
  let inWindow = 0;

  for (const f of results) {
    for (const it of f.items) {
      scanned++;
      if (!it.title) continue;
      const d = it.date ? new Date(it.date) : null;
      if (!d || isNaN(d)) continue;
      if (d < start || d > end) continue;
      inWindow++;
      // Judge on the TITLE first: headlines state the deal, descriptions ramble.
      // The amount must be in the HEADLINE. Allowing it from the description
      // let "a raise of $1 per hour" through on the strength of an unrelated
      // "$1.5 billion" further down.
      if (!MONEY_RE.test(it.title)) continue;
      if (!ROUND_RE.test(it.title + " " + it.desc)) continue;
      const key = it.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      kept[f.region].push({
        date: monD(d),
        title: it.title.slice(0, 180),
        desc: it.desc,
        source: f.name,
        link: it.link,
      });
    }
  }

  const total = kept.INDIA.length + kept.US.length;
  const trim = (arr) => arr.slice(0, Math.floor(MAX_TOTAL / 2));

  console.log("CAPITAL FLOW DIGEST");
  console.log(
    "week=" + week + "  window=" + ymd(start) + " to " + ymd(end) +
    "  scanned=" + scanned + "  in_window=" + inWindow + "  funding_items=" + total
  );
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.log("feed_errors: " + failed.map((f) => f.name + " (" + f.error + ")").join(", "));
  }

  for (const region of ["US", "INDIA"]) {
    console.log("\n=== " + region + " ===");
    const rows = trim(kept[region]);
    if (!rows.length) {
      console.log("(no funding items found in this window)");
      continue;
    }
    for (const r of rows) {
      console.log("[" + r.date + "] " + r.title + "  |src:" + r.source);
      if (r.desc) console.log("    " + r.desc);
    }
  }

  console.log("\n=== SOURCES ===");
  const srcs = [];
  for (const region of ["US", "INDIA"]) {
    for (const r of trim(kept[region])) srcs.push(r.source + " — " + r.title.slice(0, 110));
  }
  srcs.forEach((s, i) => console.log("[" + (i + 1) + "] " + s));
})();
