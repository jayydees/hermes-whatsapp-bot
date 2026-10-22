// End to end with fake db, money and Gemini. Nothing touches the network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, lastWeek, istMidnight } = require("../weekly");
const { usd } = require("./fixture-week");

let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const mk = (id, src, title, summary = "") => ({ id, feed: "f", section_hint: "", title, link: "http://x/" + id, published: "2026-11-11T10:00:00Z", summary, source_name: src });
const items = [mk("a", "OpenAI", "OpenAI launches Foo", "Foo costs 40% less to run than Bar."), mk("b", "Verge", "EU delays AI rules", "The EU delayed high-risk rules to 2028.")];
const deals = [{ item_id: "a", company: "Acme", amount_usd: 400e6, round: "C", published: "2026-11-11", title: "t" }];

const seen = {};
const deps = (gemini) => ({
  db: {
    open: () => ({}),
    itemsBetween: (db, f, t) => ((seen.range = [f, t]), items),
    dealsBetween: (db, f, t) => ((seen.dealRanges = (seen.dealRanges || []).concat([[f, t]])), deals),
  },
  money: {
    weekMoney: (d, y, prior) => ((seen.prior = prior), { total_usd: 400e6, count: 1, top: [{ company: "Acme", amount_usd: 400e6, item_id: "a" }], pct_of_ytd: 0.5, ytd_label: "AI funding", ytd_period: "Jan-Sep", ytd_source: "Crunchbase" }),
    formatUSD: usd,
  },
  ytd: () => ({}),
  runCollect: async () => {
    seen.collected = true;
  },
  apiKey: () => "SECRET-KEY",
  callGemini: gemini,
});
const good = async (o) => {
  if (o.system.includes("editor")) return { story: { id: "a", corroborating_ids: [] }, policy: [{ id: "b", region: "EU", corroborating_ids: [] }] };
  return {
    lines: [{ id: "b", text: "EU delays high-risk AI rules (to 2028)" }],
    story_text: "OpenAI launched Foo, which costs 40% less to run than Bar.",
    deal_notes: [{ item_id: "a", text: "AI model maker" }],
  };
};

check("lastWeek from a Wednesday", JSON.stringify(lastWeek("2026-11-18")) === '{"start":"2026-11-09","end":"2026-11-15","endExclusive":"2026-11-16"}');
check("lastWeek from a Monday", lastWeek("2026-11-16").start === "2026-11-09");
check("lastWeek from a Sunday", lastWeek("2026-11-15").start === "2026-11-02");
check("istMidnight is 18:30 UTC the day before", istMidnight("2026-11-09") === "2026-11-08T18:30:00.000Z");
// A story published Monday 02:00 IST (Sunday 20:30 UTC) belongs to the new week, not the one just ended.
check("Monday 02:00 IST item is outside the previous week", !("2026-11-15T20:30:00.000Z" < istMidnight("2026-11-16")));

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "aitrends-wk-"));
  process.env.AITRENDS_HOME = home;
  process.env.AITRENDS_TODAY = "2026-11-16";
  const outs = [];
  const out = (l) => outs.push(l);
  const reportFile = path.join(home, "report.txt");

  await main([], deps(good), out);
  const report = fs.readFileSync(reportFile, "utf8");
  check("normal run prints nothing", outs.length === 0, JSON.stringify(outs));
  check("collect ran", seen.collected === true);
  check("week range is Monday 00:00 IST to next Monday 00:00 IST, in UTC", seen.range.join() === "2026-11-08T18:30:00.000Z,2026-11-15T18:30:00.000Z", seen.range.join());
  check("deals use the same IST week", JSON.stringify(seen.dealRanges[0]) === JSON.stringify(seen.range), JSON.stringify(seen.dealRanges));
  check("prior 28 days of deals fetched and passed to weekMoney", JSON.stringify(seen.dealRanges[1]) === '["2026-10-11T18:30:00.000Z","2026-11-08T18:30:00.000Z"]' && Array.isArray(seen.prior), JSON.stringify(seen.dealRanges));
  check(
    "report written with expected content",
    report.startsWith("*AI This Week") && report.includes("9-15 Nov") && report.includes("*Policy*") && report.includes("EU: Delays high-risk AI rules (to 2028)") && report.includes("Acme $400M (AI model maker)"),
    report
  );
  check("no tmp file left", !fs.existsSync(reportFile + ".tmp"));
  const wk = JSON.parse(fs.readFileSync(path.join(home, "weeks", "2026-11-09.json"), "utf8"));
  check("weeks record saved", wk.selection.story.id === "a" && !!wk.lines.b && !!wk.story_text);

  seen.collected = false;
  await main(["--no-collect"], deps(good), out);
  check("--no-collect skips collect", seen.collected === false && outs.length === 0);

  fs.writeFileSync(reportFile, "OLD REPORT\n");
  const failing = async () => {
    throw new Error("Gemini HTTP 503 SECRET-KEY");
  };
  await main([], deps(failing), out);
  check("failure keeps old report.txt", fs.readFileSync(reportFile, "utf8") === "OLD REPORT\n");
  check("exactly one alert line", outs.length === 1 && !outs[0].includes("\n"), JSON.stringify(outs));
  check("alert mentions failure and hides key", /failed/.test(outs[0]) && !outs[0].includes("SECRET-KEY"), outs[0]);

  outs.length = 0;
  await main([], { ...deps(good), apiKey: () => "" }, out);
  check("missing key alerts once, report kept", outs.length === 1 && fs.readFileSync(reportFile, "utf8") === "OLD REPORT\n");
  outs.length = 0;
  const d = deps(good);
  d.db.itemsBetween = () => [];
  await main([], d, out);
  check("empty week alerts once", outs.length === 1 && /no items/.test(outs[0]));

  // Every line fails the fact check (invented name, twice): no bare-header report, old one kept.
  outs.length = 0;
  const allInvented = async (o) => {
    if (o.system.includes("editor")) return { story: { id: "a", corroborating_ids: [] }, policy: [{ id: "b", region: "EU", corroborating_ids: [] }] };
    if (o.system.includes("fix lines")) return { lines: [{ id: "b", text: "Anthropic delays AI rules" }, { id: "story", text: "Anthropic launched Foo." }] };
    return { lines: [{ id: "b", text: "Anthropic delays AI rules" }], story_text: "Anthropic launched Foo." };
  };
  await main([], deps(allInvented), out);
  check("all lines dropped: alert, old report kept", outs.length === 1 && /fact check/.test(outs[0]) && fs.readFileSync(reportFile, "utf8") === "OLD REPORT\n", JSON.stringify(outs));

  // Gemini returns ids that were never in the input: nothing invented reaches the report.
  outs.length = 0;
  const ghosts = async (o) => {
    if (o.system.includes("editor")) return { story: { id: "ghost", corroborating_ids: [] }, build: [{ id: "ghost2", corroborating_ids: [] }], policy: [{ id: "b", region: "EU", corroborating_ids: ["ghost3"] }] };
    return { lines: [{ id: "b", text: "EU delays high-risk AI rules (to 2028)" }, { id: "ghost2", text: "Ghost tool launches" }], story_text: "Ghost story" };
  };
  await main([], deps(ghosts), out);
  const g = fs.readFileSync(reportFile, "utf8");
  check("unknown ids never rendered", outs.length === 0 && !/Ghost/i.test(g) && !g.includes("*Story of the week*") && g.includes("EU: Delays high-risk AI rules"), g);

  fs.rmSync(home, { recursive: true, force: true });
  if (fails) {
    console.log(fails + " FAILED");
    process.exit(1);
  }
  console.log("ALL PASS");
})();
