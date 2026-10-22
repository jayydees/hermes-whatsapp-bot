// Renders the weekly report in WhatsApp syntax (*bold*, _italic_). Pure function, no I/O.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REGION_ORDER = ["EU", "USA", "UK", "India", "Other"];
const BLOCKS = [
  ["research", "Research"],
  ["security", "Security"],
  ["physical_ai", "Physical AI"],
  ["build", "If you build products"],
  ["business", "If you run a business"],
  ["invest", "If you invest or job-hunt"],
];

const scrub = (s) => String(s).replace(/\s*\u2014\s*/g, ", ").replace(/[\ufeff\u200b\u200d]/g, "");

// "9-15 Nov", or "28 Sep-4 Oct" across months. Both dates inclusive, YYYY-MM-DD.
function weekLabel(startISO, endISO) {
  const [, sm, sd] = startISO.split("-").map(Number);
  const [, em, ed] = endISO.split("-").map(Number);
  return sm === em ? `${sd}-${ed} ${MONTHS[em - 1]}` : `${sd} ${MONTHS[sm - 1]}-${ed} ${MONTHS[em - 1]}`;
}

const pctText = (p) => (p < 0.1 ? "<0.1%" : `${Math.round(p * 10) / 10}%`);

// The Policy renderer prints "<Region>: ", so a line that also opens with that region ("EU delays ...")
// would read "EU: EU delays ...". Strip a leading name of the entry's own region and capitalise the rest.
const REGION_NAMES = {
  EU: ["European Union", "E\\.U\\.", "EU"],
  USA: ["United States", "U\\.S\\.A\\.", "U\\.S\\.", "USA", "US", "America"],
  UK: ["United Kingdom", "U\\.K\\.", "UK", "Britain", "British [Gg]overnment"],
  India: ["Indian [Gg]overnment", "India"],
};
function stripRegion(region, text) {
  const names = REGION_NAMES[region];
  if (!names) return text;
  // Case-sensitive on purpose: "US" must not match a line that opens with the word "Us".
  const re = new RegExp(`^(?:[Tt]he\\s+)?(?:${names.join("|")})(?:'s|’s)?(?:\\s+[Gg]overnment)?\\s*:?\\s+(?!(?:and|or|&)\\s)(?=\\S)`);
  const rest = text.replace(re, "");
  if (rest === text || rest.length < 12) return text;
  return rest[0].toUpperCase() + rest.slice(1);
}

// data: { weekStart, weekEnd, money (weekMoney result), formatUSD, dealNotes: {item_id: text},
//         storyText, sections: { policy: [{region, text}], research: [{text}], ... } }
function renderReport(data) {
  const label = weekLabel(data.weekStart, data.weekEnd);
  const blocks = [`*AI This Week · ${label}*`];
  const m = data.money;
  const usd = data.formatUSD;
  const notes = data.dealNotes || {};
  const hasMoney = !!(m && m.count > 0);

  if (hasMoney) {
    const top = (m.top || []).map((d) => `${d.company} ${usd(d.amount_usd)}${notes[d.item_id] ? ` (${notes[d.item_id]})` : ""}`);
    // Without a year-to-date figure the comparison is omitted instead of printing "null%".
    const ytd = m.pct_of_ytd != null && m.ytd_label ? `, ${pctText(m.pct_of_ytd)} of 2026's ${m.ytd_label} so far` : "";
    const rows = [`• ${usd(m.total_usd)} raised by AI-native startups across ${m.count} reported deals${ytd}`];
    if (top.length) rows.push(`• Top: ${top.join(", ")}`);
    blocks.push(["*Money*", ...rows].join("\n"));
  }
  if (data.storyText) blocks.push(`*Story of the week*\n${data.storyText}`);

  const s = data.sections || {};
  const policy = [...(s.policy || [])].sort((a, b) => REGION_ORDER.indexOf(a.region) - REGION_ORDER.indexOf(b.region));
  if (policy.length) blocks.push(["*Policy*", ...policy.map((p) => `• ${p.region}: ${stripRegion(p.region, p.text)}`)].join("\n"));
  for (const [key, title] of BLOCKS) {
    if ((s[key] || []).length) blocks.push([`*${title}*`, ...s[key].map((x) => `• ${x.text}`)].join("\n"));
  }

  const foot = [];
  if (hasMoney && m.pct_of_ytd != null && m.ytd_source) foot.push(`_Funding % compares deals reported in the news with ${m.ytd_source}'s 2026 total (${m.ytd_period})._`);
  foot.push(`_Sources: AI lab blogs and news feeds, week of ${label}._`);
  blocks.push(foot.join("\n"));

  const text = scrub(blocks.join("\n\n"));
  if (text.length > 2500) process.stderr.write(`warning: report is ${text.length} chars (over 2500)\n`);
  return text;
}

module.exports = { renderReport, weekLabel, scrub, stripRegion };
