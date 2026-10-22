const { parseDeal, isAI, weekMoney, formatUSD, isNamedCompany, normCompany, FX_TO_USD, SUSPICIOUS_USD } = require("../lib/money");

let fail = 0;
let n = 0;
const check = (name, ok, extra) => {
  n++;
  if (!ok) {
    fail++;
    console.log("FAIL " + name + (extra ? " " + extra : ""));
  }
};
const near = (a, b) => Math.abs(a - b) <= Math.max(1, b * 0.001);

// Real headlines from the fixtures (crunchbase-news, techcrunch-ai, gnews-funding, inc42): [title, company, usd, round]
const REAL = [
  ["Exclusive: Chariot Raises $10M To Help Consumers Fight Back Against Hidden Fees And Hard-To-Cancel Subscriptions", "Chariot", 10e6, ""],
  ["Zenzap raises $44M for its AI chat app that aims to replace WhatsApp in the workplace", "Zenzap", 44e6, ""],
  ["Scimplify raises $25M to challenge China’s grip on critical materials with AI", "Scimplify", 25e6, ""],
  ["E-commerce AI startup Loops raises $3.5M to create smoother online shopping experiences", "Loops", 3.5e6, ""],
  ["Albert Invent Raises $55 Million To Bring AI To Chemical Experiments", "Albert Invent", 55e6, ""],
  ["Zenzap raises $33 million Series A to bring AI agents into everyday workplace chats", "Zenzap", 33e6, "Series A"],
  ["Startup Causa Prima raises $20 million to tackle billing disputes with AI agents", "Causa Prima", 20e6, ""],
  ["Mind-Reading Baseball Cap Startup Sabi Raises $50 Million From Billionaire Vinod Khosla", "Sabi", 50e6, ""],
  ["AI cloud startup Modal raises $750M at $15.75B valuation", "Modal", 750e6, ""],
  ["Fragment Raises $12 Million Series A to Turn Agents into Financial Operators", "Fragment", 12e6, "Series A"],
  ["Pluto Security raises $42M as AI gives enterprise security teams a new headache", "Pluto Security", 42e6, ""],
  ["AI startup Parallel Loop raises $6.6 million in seed funding led by 3one4 Capital", "Parallel Loop", 6.6e6, "Seed"],
  ["Harmonic Security raises $50M to govern how employees use AI tools", "Harmonic Security", 50e6, ""],
  ["Revrag AI Raises $2.5 Mn In Seed Funding Led By Accion Ventures", "Revrag AI", 2.5e6, "Seed"],
  ["Ubitium Raises $14M in New Funding to Build Universal Processor for Physical AI", "Ubitium", 14e6, ""],
  ["Indian banking AI startup RevRag raises $2.5m seed round", "RevRag", 2.5e6, "Seed"],
  ["Labelbox Raises $100M+ Series E at $1.25B Valuation to Advance RL and AI Agents", "Labelbox", 100e6, "Series E"],
  ["Ultra raises $62 million for fast-growing ‘robots as a service’ business, announces tie-up with AI research firm Physical Intelligence", "Ultra", 62e6, ""],
  ["Mueon Raises $65M Series A to Move Cubelets Toward Production Readiness", "Mueon", 65e6, "Series A"],
  ["TypeSafeAI Raises $870 Million to Scale Jev AI Automation Platform", "TypeSafeAI", 870e6, ""],
  ["AI inference infrastructure startup Modal Raises $750M Series D", "Modal", 750e6, "Series D"],
  ["AI infra startup Modal raises $750 mn at $15.7 bn valuation", "Modal", 750e6, ""],
  ["Oxford AI chip startup raises $125m to tackle data centre power crunch", "Oxford AI chip startup", 125e6, ""],
  ["Construction robotics startup Origin raises $20 Mn led by Accel, Zacua Ventures", "Origin", 20e6, ""],
  ["Shamrock AI Bags $5 Mn To Help Enterprises Deploy AI Agents Reliably", "Shamrock AI", 5e6, ""],
  ["Scimplify Bags $25 Mn To Scale Its Semiconductor Chemicals Business", "Scimplify", 25e6, ""],
  ["Confido Health Raises $12.5 Mn To Automate Healthcare Administration With AI", "Confido Health", 12.5e6, ""],
  ["Exclusive: Modal raised $750M and tops $1B in annualized run rate", "Modal", 750e6, ""],
  // Non-USD, converted with FX_TO_USD
  ["Danish startup raises €2.8 million seed to expand AI platform", "Danish startup", 2.8e6 * FX_TO_USD.EUR, "Seed"],
  ["AI-powered chemical R&D startup NuSynth Technologies raises Rs 36.5 crore led by Avaana", "NuSynth Technologies", 36.5e7 * FX_TO_USD.INR, ""],
  ["The Stack Raises ₹21.5 Cr To Broaden Its Supplements Portfolio", "The Stack", 21.5e7 * FX_TO_USD.INR, ""],
  ["Gordon Sanghera Raises £4m to Advance AI Materials Discovery", "Gordon Sanghera", 4e6 * FX_TO_USD.GBP, ""],
];
for (const [title, company, usd, round] of REAL) {
  const d = parseDeal(title, "");
  check("deal: " + title.slice(0, 60), d && d.company === company && near(d.amount_usd, usd) && d.round === round, JSON.stringify(d));
}

// Synthetic edge cases that must parse
const SYN = [
  ["Acme raises $40M Series B", "Acme", 40e6, "Series B"],
  ["Acme bags Rs 300 Cr", "Acme", 300e7 * FX_TO_USD.INR, ""],
  ["Acme secures $1.2 billion", "Acme", 1.2e9, ""],
  ["Acme lands €50M", "Acme", 50e6 * FX_TO_USD.EUR, ""],
  ["Acme raises Rs 50 lakh in pre-seed", "Acme", 50e5 * FX_TO_USD.INR, "Pre-Seed"],
  ["Acme nets $850K", "Acme", 850e3, ""],
  ["Exclusive: AI startup Acme raises $7M", "Acme", 7e6, ""],
  ["Breaking: Acme raised USD 10 million", "Acme", 10e6, ""],
  ["Acme raises $5M to fund expansion", "Acme", 5e6, ""],
  ["Acme raises £1.5bn", "Acme", 1.5e9 * FX_TO_USD.GBP, ""],
];
for (const [title, company, usd, round] of SYN) {
  const d = parseDeal(title, "");
  check("syn: " + title, d && d.company === company && near(d.amount_usd, usd) && d.round === round, JSON.stringify(d));
}

// Headlines that must NOT parse
const NONE = [
  "The Crunchbase Tech Layoffs Tracker",
  "Acme lays off 200 employees after raising $50M last year",
  "Acme acquires Beta for $2 billion",
  "Humanly acquires CareerArc to connect recruitment marketing with AI hiring",
  "VC firm closes $500M fund",
  "USV Raises $900M as AI Drives Larger Venture Funds",
  "Nilekani-backed Fundamentum AI fund raises Rs 3,000 crore for AI, deeptech fund",
  "Ramp reaches $60B valuation as it pushes deeper into AI",
  "Sequoia-backed chip startup Nuvacore raising funds at about a $2.5 billion valuation, sources say",
  "Ramaswamy Nuclear Startup Raises Funds at $1.9 Billion Value",
  "Sarvam AI in talks to raise up to $300 million at $3 billion valuation",
  "Tencent moves to raise $5 billion in bonds to fund its AI buildout",
  "Zetwerk Raises ₹2,251 Cr From Anchor Investors Ahead Of IPO",
  "Acme lands $50M contract with the Army",
  "Acme revenue rises 40% to $120M",
  "Cybersecurity Investors Put $6.8B To Work In The Third Quarter, Mostly In Larger Rounds",
  "Udaan’s FY26 Revenue Rises 13% To ₹5,134 Cr, Loss Narrows To ₹852 Cr",
  "Between October 05 and October 10, 2026, as many as 27 Indian startups from diverse sectors raised over $116 million in funding",
  "Acme raises concerns about $5 per hour wages",
  "",
];
for (const t of NONE) check("null: " + t.slice(0, 60), parseDeal(t, "") === null, JSON.stringify(parseDeal(t, "")));

// isAI
check("isAI ai", isAI("AI startup raises $5M", ""));
check("isAI llm in summary", isAI("Acme raises $5M", "Builds LLM tooling"));
check("isAI agents", isAI("Fragment turns agents into financial operators", ""));
check("isAI robotics", isAI("Construction robotics startup Origin raises", ""));
check("isAI machine learning", isAI("x", "uses Machine Learning"));
check("isAI autonomous", isAI("Autonomous trucks", ""));
check("isAI computer vision", isAI("x", "a computer vision company"));
check("isAI genai", isAI("GenAI platform", ""));
check("isAI not Thai", !isAI("Thai baht falls", "Thai officials said"));
check("isAI not said/paid", !isAI("He said she paid", "again said"));
check("isAI not chair/maid", !isAI("The chair and the maid", "available"));
check("isAI empty", !isAI("", ""));

// weekMoney
{
  const ytd = { amount_usd: 490e9, label: "~$490B", period: "Jan-Sep 2026", source: "Crunchbase" };
  const deals = [
    { item_id: "a", company: "Zenzap", amount_usd: 33e6 },
    { item_id: "b", company: "Zenzap", amount_usd: 44e6 },
    { item_id: "c", company: "RevRag AI", amount_usd: 2.5e6 },
    { item_id: "d", company: "RevRag", amount_usd: 2.5e6 },
    { item_id: "e", company: "Modal", amount_usd: 750e6 },
    { item_id: "f", company: "Modal Inc.", amount_usd: 750e6 },
    { item_id: "g", company: "Ramp", amount_usd: 1.85e9 },
  ];
  const w = weekMoney(deals, ytd);
  check("week count dedupes", w.count === 4, String(w.count));
  check("week total keeps largest", near(w.total_usd, 44e6 + 2.5e6 + 750e6 + 1.85e9), String(w.total_usd));
  check("week top 2", w.top.length === 2 && w.top[0].company === "Ramp" && w.top[1].company.startsWith("Modal"), JSON.stringify(w.top));
  check("week top has item_id", w.top[0].item_id === "g");
  check("week pct", w.pct_of_ytd === Math.round((w.total_usd / 490e9) * 1000) / 10, String(w.pct_of_ytd));
  check("week pct one decimal", Number.isInteger(w.pct_of_ytd * 10));
  check("week ytd fields", w.ytd_label === "~$490B" && w.ytd_period === "Jan-Sep 2026" && w.ytd_source === "Crunchbase");
  const e = weekMoney([], ytd);
  check("week empty", e.total_usd === 0 && e.count === 0 && e.top.length === 0 && e.pct_of_ytd === 0);
  check("week single deal top", weekMoney([deals[0]], ytd).top.length === 1);
}

// Top line shows proper-noun names only; descriptors from real fixture headlines never appear there.
for (const c of ["Modal", "Salience Labs", "RevRag AI", "FLÆ Robotics", "TypeSafeAI", "The Stack", "Stella & Dot", "NuSynth Technologies"]) {
  check("named: " + c, isNamedCompany(c));
}
for (const c of [
  "Danish startup", "Danish legaltech startup", "Former Plaud exec", "Oxford AI chip startup", "Female-founded AI startup",
  "Scottsdale AI startup", "This Y Combinator startup", "Stella & Dot Founder", "London’s Obsero", "London's Obsero",
  "Vietnamese-founded Drylab", "19-Year-Old Zach Yadegari", "Rejected by Harvard and Stanford, 19-year-old", "indian startup", "",
]) {
  check("descriptor: " + c, !isNamedCompany(c));
}

// Dedupe keys: legal and "Labs/AI/Technologies" suffixes collapse; distinct names stay distinct.
check("norm Modal Labs", normCompany("Modal Labs") === normCompany("Modal") && normCompany("Modal Labs, Inc.") === normCompany("Modal"));
check("norm Technologies", normCompany("NuSynth Technologies") === normCompany("NuSynth"));
check("norm AI suffix", normCompany("RevRag AI") === normCompany("Revrag"));
check("norm keeps single word", normCompany("Labs") === "labs" && normCompany("AI") === "ai");
check("norm distinct", normCompany("Modal") !== normCompany("Model"));

{
  const ytd = { amount_usd: 490e9, label: "~$490B", period: "Jan-Sep 2026", source: "Crunchbase" };
  // Same round in Google News and TechCrunch with different company strings counts once.
  const w = weekMoney([
    { item_id: "gn", company: "Modal", amount_usd: 750e6 },
    { item_id: "tc", company: "Modal Labs Inc", amount_usd: 750e6 },
    { item_id: "x", company: "Salience Labs", amount_usd: 125e6 },
    { item_id: "y", company: "Oxford AI chip startup", amount_usd: 125e6 }, // same round as Salience, unnamed
    { item_id: "z1", company: "19-Year-Old Zach Yadegari", amount_usd: 10e6 },
    { item_id: "z2", company: "Rejected by Harvard and Stanford, 19-year-old", amount_usd: 10e6 }, // same round, two descriptors
    { item_id: "dk", company: "Danish startup", amount_usd: 3.2e6 },
  ], ytd);
  check("cross-feed duplicate counted once", w.count === 4 && near(w.total_usd, 750e6 + 125e6 + 10e6 + 3.2e6), `${w.count} ${w.total_usd}`);
  check("top line names only", w.top.length === 2 && w.top[0].company === "Modal" && w.top[1].company === "Salience Labs", JSON.stringify(w.top));

  // Fewer than two named deals: show what there is, or none.
  const one = weekMoney([{ item_id: "a", company: "Danish startup", amount_usd: 5e6 }, { item_id: "b", company: "Clueso", amount_usd: 10e6 }], ytd);
  check("one named deal: top has one, total has both", one.top.length === 1 && one.top[0].company === "Clueso" && one.count === 2 && near(one.total_usd, 15e6), JSON.stringify(one));
  const none = weekMoney([{ item_id: "a", company: "Former Plaud exec", amount_usd: 26e6 }], ytd);
  check("no named deal: top empty, still counted", none.top.length === 0 && none.count === 1 && none.total_usd === 26e6);

  // Suspicious single deal over $20B is excluded from total and top.
  const realWrite = process.stderr.write;
  const errs = [];
  process.stderr.write = (s) => (errs.push(String(s)), true);
  const sus = weekMoney([{ item_id: "big", company: "BigCo", amount_usd: 40e9 }, { item_id: "ok", company: "Acme", amount_usd: 50e6 }], ytd);
  process.stderr.write = realWrite;
  check("deal over $20B excluded", sus.count === 1 && sus.total_usd === 50e6 && sus.top.every((d) => d.company !== "BigCo"), JSON.stringify(sus));
  check("suspicious deal logged to stderr", errs.some((e) => /suspicious deal BigCo/.test(e)));
  check("exactly $20B still counts", weekMoney([{ item_id: "e", company: "Edge", amount_usd: SUSPICIOUS_USD }], ytd).count === 1);

  // A round already counted in a prior week is not counted again.
  const again = weekMoney(
    [{ item_id: "n1", company: "Modal Labs", amount_usd: 750e6 }, { item_id: "n2", company: "Acme", amount_usd: 5e6 }],
    ytd,
    [{ item_id: "o1", company: "Modal", amount_usd: 750e6 }]
  );
  check("prior-week round not recounted", again.count === 1 && again.total_usd === 5e6 && again.top[0].company === "Acme", JSON.stringify(again));
  check("no ytd gives null pct", weekMoney([{ item_id: "a", company: "Acme", amount_usd: 5e6 }], {}).pct_of_ytd === null);
}

// formatUSD
check("fmt 2.1B", formatUSD(2.1e9) === "$2.1B", formatUSD(2.1e9));
check("fmt 2B whole", formatUSD(2e9) === "$2B", formatUSD(2e9));
check("fmt 15.75B", formatUSD(15.75e9) === "$16B", formatUSD(15.75e9));
check("fmt 600M", formatUSD(600e6) === "$600M", formatUSD(600e6));
check("fmt 40M", formatUSD(40e6) === "$40M", formatUSD(40e6));
check("fmt 850K", formatUSD(850e3) === "$850K", formatUSD(850e3));
check("fmt 1.85B", formatUSD(1.85e9) === "$1.9B", formatUSD(1.85e9));
check("fmt 3.5M", formatUSD(3.5e6) === "$3.5M", formatUSD(3.5e6));
check("fmt 0", formatUSD(0) === "$0");

console.log(fail === 0 ? `ALL PASS (${n} checks)` : `${fail} of ${n} FAILED`);
process.exit(fail === 0 ? 0 : 1);
