const { renderReport, weekLabel, stripRegion } = require("../build");
const { data } = require("./fixture-week");
let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const clone = () => JSON.parse(JSON.stringify(data));
const withFns = (d) => Object.assign(d, { formatUSD: data.formatUSD });
const DOT = String.fromCharCode(0xb7), BUL = String.fromCharCode(0x2022);

const expected = [
  `*AI This Week ${DOT} 9-15 Nov*`,
  ``,
  `*Money*`,
  `${BUL} $2.1B raised by AI-native startups across 14 reported deals, 3.2% of 2026's AI funding so far`,
  `${BUL} Top: Acme Robotics $400M (warehouse robots), Lumen AI $250M (legal search)`,
  ``,
  `*Story of the week*`,
  `OpenAI released Foo, a model that costs 40% less to run than Bar. Developers can use it through the API today.`,
  ``,
  `*Policy*`,
  `${BUL} EU: Delays high-risk AI rules to 2028 (more time for firms)`,
  `${BUL} USA: Senate advances an AI chip export bill`,
  ``,
  `*Research*`,
  `${BUL} Labs show a small model matching a larger one (10x cheaper to train)`,
  ``,
  `*Security*`,
  `${BUL} Acme chatbot leaks customer chats (two firms confirm)`,
  ``,
  `*Physical AI*`,
  `${BUL} Zed humanoid begins warehouse pilot (first paid deployment)`,
  ``,
  `*If you build products*`,
  `${BUL} Foo API (OpenAI): 40% cheaper per token than Bar`,
  ``,
  `*If you run a business*`,
  `${BUL} Bank cuts support backlog with agents (60% fewer tickets)`,
  ``,
  `*If you invest or job-hunt*`,
  `${BUL} BigCo buys Lumen AI (consolidation in legal AI)`,
  ``,
  `_Funding % compares deals reported in the news with Crunchbase's 2026 total (Jan-Sep)._`,
  `_Sources: AI lab blogs and news feeds, week of 9-15 Nov._`,
].join("\n");

const out = renderReport(data);
check("full render matches expected exactly", out === expected, "\n" + out);

check("week label same month", weekLabel("2026-11-09", "2026-11-15") === "9-15 Nov");
check("week label across months", weekLabel("2026-09-28", "2026-10-04") === "28 Sep-4 Oct");
check("week label across years", weekLabel("2026-12-28", "2027-01-03") === "28 Dec-3 Jan");

let d = clone(); withFns(d);
d.weekStart = "2026-09-28"; d.weekEnd = "2026-10-04";
check("cross-month header and footer", renderReport(d).startsWith(`*AI This Week ${DOT} 28 Sep-4 Oct*`) && renderReport(d).includes("week of 28 Sep-4 Oct._"));

d = clone(); withFns(d); d.money.pct_of_ytd = 0.04;
check("pct under 0.1 prints <0.1%", renderReport(d).includes("deals, <0.1% of 2026's"));
d = clone(); withFns(d); d.money.pct_of_ytd = 12;
check("whole pct has no trailing .0", renderReport(d).includes("deals, 12% of 2026's"));

d = clone(); withFns(d); d.money.count = 0;
const noMoney = renderReport(d);
check("money count 0 omits Money section and funding footnote", !noMoney.includes("*Money*") && !noMoney.includes("Funding %"));

d = clone(); withFns(d); d.sections.security = []; d.sections.policy = []; d.storyText = "";
const sparse = renderReport(d);
check("empty sections omitted", !sparse.includes("*Security*") && !sparse.includes("*Policy*") && !sparse.includes("*Story of the week*") && sparse.includes("*Research*"));
check("no triple newlines", !/\n\n\n/.test(sparse));

d = clone(); withFns(d); d.dealNotes = {};
check("missing deal note omits parentheses", renderReport(d).includes(`${BUL} Top: Acme Robotics $400M, Lumen AI $250M`));

d = clone(); withFns(d);
const EM = String.fromCharCode(0x2014), ZW = String.fromCharCode(0x200b), ZJ = String.fromCharCode(0x200d), BOM = String.fromCharCode(0xfeff);
d.storyText = `Foo ${EM} launched${ZW}${ZJ}${BOM} today`;
const dirty = renderReport(d);
check("em dash and invisible chars scrubbed from output", ![EM, ZW, ZJ, BOM].some((c) => dirty.includes(c)) && dirty.includes("Foo, launched today"));
check("clean report has none of them", ![EM, ZW, ZJ, BOM].some((c) => out.includes(c)));
check("report length sane", out.length < 2500, String(out.length));

// Policy lines must not repeat the region that the renderer already prints.
for (const [region, line, want] of [
  ["EU", "EU delays high-risk AI rules to 2028", "Delays high-risk AI rules to 2028"],
  ["EU", "The European Union fines X over chatbot data", "Fines X over chatbot data"],
  ["USA", "U.S. Senate advances an AI chip export bill", "Senate advances an AI chip export bill"],
  ["USA", "US government sets AI procurement rules", "Sets AI procurement rules"],
  ["UK", "UK's AI Security Institute tests new models", "AI Security Institute tests new models"],
  ["UK", "Britain opens AI growth zones in Wales", "Opens AI growth zones in Wales"],
  ["India", "Indian government drafts AI labelling rules", "Drafts AI labelling rules"],
  ["India", "India: MeitY drafts AI labelling rules", "MeitY drafts AI labelling rules"],
  ["USA", "US and EU agree on AI safety tests", "US and EU agree on AI safety tests"],
  ["USA", "US-China chip curbs widen to AI models", "US-China chip curbs widen to AI models"],
  ["EU", "European Commission opens AI Act probe", "European Commission opens AI Act probe"],
  ["UK", "US lab signs UK safety pact for models", "US lab signs UK safety pact for models"],
  ["Other", "Japan passes AI promotion law", "Japan passes AI promotion law"],
  ["USA", "Users get new AI disclosure rights", "Users get new AI disclosure rights"],
]) check("strip region: " + line, stripRegion(region, line) === want, stripRegion(region, line));
d = clone(); withFns(d); d.sections.policy = [{ region: "EU", text: "EU delays AI Act fines by a year" }];
check("rendered policy has no doubled region", renderReport(d).includes(`${BUL} EU: Delays AI Act fines by a year`) && !renderReport(d).includes("EU: EU"));

// Missing year-to-date figure: omit the comparison rather than print "null%".
d = clone(); withFns(d); d.money.pct_of_ytd = null; d.money.ytd_label = null; d.money.ytd_source = null;
const noYtd = renderReport(d);
check("no ytd: money line has no comparison", noYtd.includes(`${BUL} $2.1B raised by AI-native startups across 14 reported deals\n`) && !/null/.test(noYtd), noYtd.slice(0, 300));
check("no ytd: funding footnote omitted", !noYtd.includes("Funding %"));
d = clone(); withFns(d); d.money.top = [];
check("no named deals: Top line omitted", !renderReport(d).includes("Top:"));

if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
