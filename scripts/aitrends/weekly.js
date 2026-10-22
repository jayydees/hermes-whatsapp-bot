// Weekly cron job: collect, select, explain, render, write report.txt.
// Normal run prints nothing to stdout. On any failure the old report.txt is kept and ONE alert
// line goes to stdout (cron delivers it to the owner's WhatsApp DM). Exit code is always 0.
const fs = require("fs");
const path = require("path");

const DAY = 24 * 3600e3;
const home = () => process.env.AITRENDS_HOME || "/opt/data/aitrends";

// KEY=VALUE lines, CRLF safe. Never logs values.
function loadEnv(file = "/opt/data/.env") {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    return {};
  }
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r/g, "").trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
// "2026-11-09" -> "2026-11-08T18:30:00.000Z", the UTC instant of 00:00 IST on that day.
const istMidnight = (dayISO) => new Date(dayISO + "T00:00:00+05:30").toISOString();
// A round already counted in the previous four weeks is not counted again (later articles re-report raises).
const PRIOR_DEAL_DAYS = 28;

// Previous Monday-Sunday in IST. Returns { start, end (inclusive Sunday), endExclusive (next Monday) }.
function lastWeek(todayISO) {
  const today = Date.parse(todayISO + "T00:00:00Z");
  const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
  const thisMonday = today - sinceMonday * DAY;
  return { start: isoDay(thisMonday - 7 * DAY), end: isoDay(thisMonday - DAY), endExclusive: isoDay(thisMonday) };
}

function defaultDeps() {
  return {
    db: require("./lib/db"),
    money: require("./lib/money"),
    callGemini: require("./lib/gemini").callGemini,
    ytd: () => JSON.parse(fs.readFileSync(path.join(__dirname, "ytd.json"), "utf8")),
    runCollect: () => {
      const file = path.join(__dirname, "collect.js");
      return fs.existsSync(file) ? require(file).runCollect() : undefined;
    },
    apiKey: () => process.env.GEMINI_API_KEY || loadEnv().GEMINI_API_KEY,
  };
}

async function generate(deps, { today, collect }) {
  const wk = lastWeek(today);
  const apiKey = deps.apiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");
  if (collect) {
    try {
      await deps.runCollect();
    } catch (e) {
      process.stderr.write("collect failed, using stored items: " + e.message + "\n");
    }
  }
  const dbh = deps.db.open(path.join(home(), "aitrends.db"));
  // Stored dates are UTC ISO strings; the week is Monday 00:00 to Monday 00:00 IST.
  const from = istMidnight(wk.start);
  const to = istMidnight(wk.endExclusive);
  const items = deps.db.itemsBetween(dbh, from, to);
  const deals = deps.db.dealsBetween(dbh, from, to);
  const priorDeals = deps.db.dealsBetween(dbh, new Date(Date.parse(from) - PRIOR_DEAL_DAYS * DAY).toISOString(), from);
  if (typeof dbh.close === "function") dbh.close();
  if (!items.length) throw new Error("no items collected for the week");

  const { selectItems, explainItems, assemble } = require("./write");
  const { renderReport } = require("./build");
  const money = deps.money.weekMoney(deals, deps.ytd(), priorDeals);
  const itemsById = new Map(items.map((it) => [it.id, it]));
  const g = { callGemini: deps.callGemini, apiKey };

  const selection = await selectItems(items, g);
  const explained = await explainItems(selection, itemsById, { ...g, topDeals: money.top || [] });
  const { storyText, sections } = assemble(selection, explained);
  // A report with no story and no line would be a bare header; keep last week's report and alert instead.
  if (!storyText && !Object.values(sections).some((list) => list.length)) throw new Error("no line passed the fact check");
  const report = renderReport({
    weekStart: wk.start,
    weekEnd: wk.end,
    money,
    formatUSD: deps.money.formatUSD,
    dealNotes: explained.deal_notes,
    storyText,
    sections,
  });
  return { wk, selection, explained, money, report };
}

function writeAtomic(file, text) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

async function main(argv = process.argv.slice(2), deps = null, out = console.log) {
  const today = process.env.AITRENDS_TODAY || isoDay(Date.now() + 19800000);
  try {
    deps = deps || defaultDeps();
    const r = await generate(deps, { today, collect: !argv.includes("--no-collect") });
    const dir = home();
    fs.mkdirSync(path.join(dir, "weeks"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "weeks", r.wk.start + ".json"),
      JSON.stringify({ week: r.wk, selection: r.selection, lines: r.explained.lines, story_text: r.explained.story_text, deal_notes: r.explained.deal_notes, money: r.money }, null, 2)
    );
    writeAtomic(path.join(dir, "report.txt"), r.report + "\n");
  } catch (e) {
    let key = "";
    try {
      key = (deps && deps.apiKey && deps.apiKey()) || "";
    } catch (_) {}
    const msg = String((e && e.message) || e).split(key || "\0").join("[key]").replace(/\s+/g, " ").slice(0, 200);
    out(`AI This Week report failed (${msg}). Last week's report is still in place.`);
  }
}

if (require.main === module) main().then(() => process.exit(0));

module.exports = { main, lastWeek, loadEnv, istMidnight };
