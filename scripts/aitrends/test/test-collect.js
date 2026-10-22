const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { runCollect } = require("../collect");
const { open, itemsBetween, dealsBetween } = require("../lib/db");
const { parseFeed } = require("../lib/rss");

let fail = 0;
let n = 0;
const check = (name, ok, extra) => {
  n++;
  if (!ok) {
    fail++;
    console.log("FAIL " + name + (extra ? " " + extra : ""));
  }
};
const FIX = path.join(__dirname, "fixtures");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "aitrends-"));

const FEEDS = [
  { name: "Crunchbase News", url: "https://fake.test/cb", section_hint: "money", source_name: "Crunchbase News", file: "crunchbase-news.xml" },
  { name: "Google News Funding", url: "https://fake.test/gn", section_hint: "money", source_name: "Google News", file: "gnews-funding.xml" },
  { name: "Inc42", url: "https://fake.test/inc42", section_hint: "money", source_name: "Inc42", file: "inc42.xml" },
  { name: "The Verge", url: "https://fake.test/verge", section_hint: "story", source_name: "The Verge", file: "verge-ai.xml" },
  { name: "UK Gov", url: "https://fake.test/gov", section_hint: "policy", source_name: "UK Gov", file: "govuk-ai.atom" },
  { name: "The Record", url: "https://fake.test/record", section_hint: "security", source_name: "The Record", file: "therecord.xml" },
  { name: "Broken Feed", url: "https://fake.test/broken", section_hint: "research", source_name: "Broken" },
];
const byUrl = Object.fromEntries(FEEDS.map((f) => [f.url, f]));
const okResponse = (text) => ({ ok: true, status: 200, text: async () => text });
const fakeFetch = async (url) => {
  const f = byUrl[url];
  if (!f || !f.file) return { ok: false, status: 503, text: async () => "" };
  return okResponse(fs.readFileSync(path.join(FIX, f.file), "utf8"));
};

(async () => {
  const home = tmp();
  const now = new Date("2026-10-16T05:00:00.000Z");

  // Normal run: stdout must stay silent.
  const written = [];
  const realWrite = process.stdout.write;
  process.stdout.write = (s) => (written.push(String(s)), true);
  let res;
  try {
    res = await runCollect({ feeds: FEEDS, fetchImpl: fakeFetch, now, home });
  } finally {
    process.stdout.write = realWrite;
  }
  check("normal run prints nothing to stdout", written.length === 0, written.join(""));
  check("normal run raises no alerts", res.alerts.length === 1 && /research/.test(res.alerts[0]), JSON.stringify(res.alerts));
  check("not allFailed", res.allFailed === false);

  const db = open(path.join(home, "aitrends.db"));
  const all = db.prepare("SELECT * FROM items").all();
  let expected = 0;
  for (const f of FEEDS.filter((x) => x.file)) {
    expected += new Set(parseFeed(fs.readFileSync(path.join(FIX, f.file), "utf8"), f).map((i) => i.id)).size;
  }
  check("items stored (dedup by id)", all.length > 0 && all.length <= expected && all.length >= expected - 5, `${all.length} vs ${expected}`);
  check("section_hint stored", db.prepare("SELECT COUNT(*) c FROM items WHERE section_hint='policy'").get().c === 20);
  check("first_seen stamped", all.every((i) => i.first_seen === now.toISOString()));

  const deals = db.prepare("SELECT * FROM deals").all();
  check("deals extracted", deals.length >= 10, String(deals.length));
  check("known deal: Modal $750M", deals.some((d) => d.company === "Modal" && d.amount_usd === 750e6));
  check("known deal: Zenzap", deals.some((d) => d.company === "Zenzap" && d.amount_usd === 44e6));
  check("known deal: Marklo-era Stella & Dot", deals.some((d) => /Stella/.test(d.company)));
  check("inc42 deal via money hint", deals.some((d) => d.company === "Confido Health"));
  check("non-AI funding skipped", !deals.some((d) => d.company === "Chariot"));
  check("no deal without amount", deals.every((d) => d.amount_usd > 0));
  check("deal published is ISO", deals.every((d) => /^\d{4}-\d{2}-\d{2}T/.test(d.published)));
  check("deal rows reference items", deals.every((d) => db.prepare("SELECT 1 FROM items WHERE id=?").get(d.item_id)));

  // raw archive
  const rawDir = path.join(home, "raw", "2026-10-16");
  const raws = fs.readdirSync(rawDir).sort();
  check("raw gz for each ok feed", raws.length === 6 && raws.includes("Crunchbase News.xml.gz"), raws.join(","));
  check("no raw for failed feed", !raws.includes("Broken Feed.xml.gz"));
  const back = zlib.gunzipSync(fs.readFileSync(path.join(rawDir, "UK Gov.xml.gz"))).toString("utf8");
  check("raw gunzips to original", back === fs.readFileSync(path.join(FIX, "govuk-ai.atom"), "utf8"));

  // runs
  const runs = db.prepare("SELECT * FROM runs ORDER BY feed").all();
  check("one run per feed", runs.length === FEEDS.length, String(runs.length));
  const broken = runs.find((r) => r.feed === "Broken Feed");
  check("failed run recorded", broken && broken.ok === 0 && /HTTP 503/.test(broken.error) && broken.items === 0, JSON.stringify(broken));
  const verge = runs.find((r) => r.feed === "The Verge");
  check("ok run recorded", verge.ok === 1 && verge.items === 10 && verge.error === null);

  // range queries
  const wk = itemsBetween(db, "2026-10-09T00:00:00.000Z", "2026-10-16T00:00:00.000Z");
  check("itemsBetween returns in-range items newest first", wk.length > 0 && wk.every((i, k) => k === 0 || (wk[k - 1].published || wk[k - 1].first_seen) >= (i.published || i.first_seen)));
  check("itemsBetween excludes upper bound", itemsBetween(db, "2026-10-16T05:00:00.000Z", "2026-10-16T05:00:00.000Z").length === 0);
  check("dealsBetween bounded", dealsBetween(db, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z").length === deals.length && dealsBetween(db, "2027-01-01T00:00:00.000Z", "2027-02-01T00:00:00.000Z").length === 0);
  db.close();

  // Re-run later: first_seen is never overwritten, rows are not duplicated.
  await runCollect({ feeds: FEEDS, fetchImpl: fakeFetch, now: new Date("2026-10-23T05:00:00.000Z"), home });
  const db2 = open(path.join(home, "aitrends.db"));
  check("rerun keeps item count", db2.prepare("SELECT COUNT(*) c FROM items").get().c === all.length);
  check("rerun keeps first_seen", db2.prepare("SELECT COUNT(*) c FROM items WHERE first_seen=?").get(now.toISOString()).c === all.length);
  check("rerun keeps deal count", db2.prepare("SELECT COUNT(*) c FROM deals").get().c === deals.length);
  check("rerun adds runs", db2.prepare("SELECT COUNT(*) c FROM runs").get().c === FEEDS.length * 2);
  db2.close();
  check("raw kept permanently (second day added)", fs.readdirSync(path.join(home, "raw")).length === 2);

  // <60% success -> alert; a fully dead section -> alert
  const home2 = tmp();
  const mostlyDown = async (url) => (url === FEEDS[0].url || url === FEEDS[3].url ? fakeFetch(url) : { ok: false, status: 500, text: async () => "" });
  const r2 = await runCollect({ feeds: FEEDS, fetchImpl: mostlyDown, now, home: home2 });
  check("alert when <60% succeed", r2.alerts.some((a) => /only 2\/7 feeds succeeded/.test(a)), JSON.stringify(r2.alerts));
  check("alert for dead section", r2.alerts.some((a) => /no feed succeeded for section policy/.test(a)));
  check("partial failure not allFailed", r2.allFailed === false);

  // Exactly 60% (3 of 5) does not alert on ratio
  const home3 = tmp();
  const five = FEEDS.slice(0, 5);
  const down2 = async (url) => (url === five[3].url || url === five[4].url ? { ok: false, status: 500, text: async () => "" } : fakeFetch(url));
  const r3 = await runCollect({ feeds: five, fetchImpl: down2, now, home: home3 });
  check("no ratio alert at 60%", !r3.alerts.some((a) => /feeds succeeded/.test(a)), JSON.stringify(r3.alerts));
  check("dead sections still alert at 60%", r3.alerts.length === 2, JSON.stringify(r3.alerts));

  // Every feed failing, including a thrown network error and an empty feed
  const home4 = tmp();
  const boom = async (url) => {
    if (url === FEEDS[0].url) throw new Error("ECONNRESET");
    if (url === FEEDS[1].url) return okResponse("<rss><channel></channel></rss>");
    return { ok: false, status: 404, text: async () => "" };
  };
  const r4 = await runCollect({ feeds: FEEDS, fetchImpl: boom, now, home: home4 });
  check("allFailed when every feed fails", r4.allFailed === true);
  check("network error captured", r4.counts.some((c) => /Crunchbase News: FAILED \(ECONNRESET\)/.test(c)), r4.counts.join("|"));
  check("empty feed counts as failure", r4.counts.some((c) => /Google News Funding: FAILED \(parsed 0 items\)/.test(c)));

  // Twice-daily collection: a feed that bumps an entry's date, and an undated funding item, must not
  // move into a later week (that would report or count them twice).
  const home6 = tmp();
  const mini = [{ name: "Mini", url: "https://fake.test/mini", section_hint: "money", source_name: "Mini" }];
  const feedXml = (date) =>
    `<rss><channel>
      <item><title>Acme AI raises $40M Series B</title><link>https://x.test/acme</link>${date ? `<pubDate>${date}</pubDate>` : ""}<description>AI agents</description></item>
      <item><title>Bolt robotics startup Bolt raises $12M</title><link>https://x.test/bolt</link><description>robots</description></item>
    </channel></rss>`;
  const miniFetch = (date) => async () => okResponse(feedXml(date));
  await runCollect({ feeds: mini, fetchImpl: miniFetch("Tue, 10 Nov 2026 09:00:00 GMT"), now: new Date("2026-11-10T10:00:00.000Z"), home: home6 });
  await runCollect({ feeds: mini, fetchImpl: miniFetch("Mon, 16 Nov 2026 09:00:00 GMT"), now: new Date("2026-11-16T22:00:00.000Z"), home: home6 });
  const db6 = open(path.join(home6, "aitrends.db"));
  const acme = db6.prepare("SELECT * FROM items WHERE link='https://x.test/acme'").get();
  check("re-dated item keeps first published date", acme.published === "2026-11-10T09:00:00.000Z", acme.published);
  const d6 = db6.prepare("SELECT * FROM deals ORDER BY company").all();
  check("two deals, one row each after two runs", d6.length === 2, JSON.stringify(d6));
  check("undated deal keeps first_seen as its date", d6.find((d) => d.company === "Bolt").published === "2026-11-10T10:00:00.000Z", JSON.stringify(d6));
  check("re-dated deal keeps first published date", d6.find((d) => /Acme/.test(d.company)).published === "2026-11-10T09:00:00.000Z");
  const nextWeek = ["2026-11-15T18:30:00.000Z", "2026-11-22T18:30:00.000Z"];
  check("nothing from the first week leaks into the next week", itemsBetween(db6, ...nextWeek).length === 0 && dealsBetween(db6, ...nextWeek).length === 0);
  check("both items in their own IST week", itemsBetween(db6, "2026-11-08T18:30:00.000Z", "2026-11-15T18:30:00.000Z").length === 2);
  db6.close();

  // --dry writes nothing
  const home5 = tmp();
  await runCollect({ feeds: FEEDS, fetchImpl: fakeFetch, now, home: home5, dry: true });
  check("dry run writes nothing", fs.readdirSync(home5).length === 0);

  console.log(fail === 0 ? `ALL PASS (${n} checks)` : `${fail} of ${n} FAILED`);
  process.exit(fail === 0 ? 0 : 1);
})();
