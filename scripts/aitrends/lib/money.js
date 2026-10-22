// Funding-headline parsing, AI relevance, and weekly money rollup.

// Approximate FX rates to USD. Fixed constants, set October 2026 (about 88 INR, 0.86 EUR, 0.75 GBP per USD);
// refresh when they drift noticeably. The report shows rounded totals, so a few percent of drift is below
// what readers can see. Any other currency is not parsed (AMOUNT_RE), so it never reaches the total.
const FX_TO_USD = { USD: 1, INR: 1 / 88, EUR: 1.16, GBP: 1.34 };

// A single round above this is far likelier to be a headline parsing error (valuation, fund size, revenue)
// than a real deal, so it is left out of the total and the Top line.
const SUSPICIOUS_USD = 20e9;

const CRORE = 1e7;
const LAKH = 1e5;

const CUR_RE = "(?:US\\$|USD|\\$|\\u20ac|EUR|\\u00a3|GBP|\\u20b9|INR|Rs\\.?)";
const NUM_RE = "\\d[\\d,]*(?:\\.\\d+)?";
// Single-letter units must touch the number ("$40M"); word units may follow a space ("$40 million").
const UNIT_RE = "(?:\\s?(?:billion|million|thousand|bn|mn|crores?|cr|lakhs?|lacs?)|b|m|k)";
const AMOUNT_RE = new RegExp("(" + CUR_RE + ")\\s?(" + NUM_RE + ")(" + UNIT_RE + ")?(?![\\w])", "gi");

const VERB_RE = /\b(?:raises|raised|bags|bagged|secures|secured|lands|landed|nets|netted|snags|snagged|scores|scored|gets|receives|closes|pockets|mops up|pulls in|picks up|rakes in|attracts)\b/gi;
// "to raise", "in talks to raise", "will raise": a plan, not a completed round.
const FUTURE_RE = /\b(?:to|will|would|could|may|might|plans?|seeks?|expects?|aims?|hopes?|looks?)\s*$/i;
const SKIP_CONTEXT_RE = /\bIPO\b|anchor investors?|\bbonds?\b|debentures?|\bNCDs?\b/i;
const NOT_A_ROUND_TAIL_RE = /^\s*(?:\w+\s+){0,2}(?:contract|deal|order|tender|settlement|lawsuit|fine|penalty)\b/i;
const FUND_TAIL_RE = /^\s*(?:(?!to\b)[\w-]+\s+){0,2}funds?\b|^[^.;]{0,50}\bfunds\b|\bfund[.!?]?\s*$/i;
const FUND_SUBJECT_RE = /\b(?:funds?|ventures?|vc|vcs|capital|partners|investors?)\b/i;
const PREFIX_RE = /^(?:exclusive|breaking|report|update|watch|just in|scoop)\s*:\s*/i;
const ROUND_RE = /\b(pre-?seed|seed|pre-?series\s+[a-c]|series\s+[a-k]\+?|angel)\b/i;

function parseAmount(m) {
  const cur = m[1].toUpperCase().replace(/\.$/, "");
  const num = parseFloat(m[2].replace(/,/g, ""));
  const unit = (m[3] || "").trim().toLowerCase();
  let mult = 1;
  if (/^b/.test(unit)) mult = 1e9;
  else if (/^m/.test(unit)) mult = 1e6;
  else if (/^(k|thousand)/.test(unit)) mult = 1e3;
  else if (/^cr/.test(unit)) mult = CRORE;
  else if (/^la/.test(unit)) mult = LAKH;
  let code = "USD";
  if (cur === "₹" || cur === "INR" || cur === "RS") code = "INR";
  else if (cur === "€" || cur === "EUR") code = "EUR";
  else if (cur === "£" || cur === "GBP") code = "GBP";
  if (!unit && num < 10000) return null; // "$1 per hour" is not a funding round
  return num * mult * FX_TO_USD[code];
}

function cleanCompany(text) {
  let s = text.trim();
  let prev;
  do {
    prev = s;
    s = s.replace(PREFIX_RE, "").trim();
  } while (s !== prev);
  const colon = s.lastIndexOf(": ");
  if (colon >= 0) s = s.slice(colon + 2).trim();
  // "E-commerce AI startup Loops" -> "Loops" when a capitalised name follows the descriptor.
  const d = s.match(/^.*\b(?:startup|start-up|firm|company|maker|unicorn)\s+(?=[A-Z0-9])/i);
  if (d && d[0].length < s.length) s = s.slice(d[0].length).trim();
  return s.replace(/[\s,:;-]+$/, "").slice(0, 80);
}

// Returns { company, amount_usd, round } for a completed funding round in a headline, else null.
function parseDeal(title, summary) {
  void summary; // headlines state the deal; summaries ramble and mix in unrelated amounts
  const t = String(title || "").replace(/\s+/g, " ").trim();
  if (!t || SKIP_CONTEXT_RE.test(t)) return null;
  VERB_RE.lastIndex = 0;
  let vm;
  while ((vm = VERB_RE.exec(t))) {
    const before = t.slice(0, vm.index);
    if (FUTURE_RE.test(before)) continue;
    const after = t.slice(vm.index + vm[0].length);
    AMOUNT_RE.lastIndex = 0;
    let am;
    while ((am = AMOUNT_RE.exec(after))) {
      const pre = after.slice(0, am.index);
      const tail = after.slice(am.index + am[0].length);
      if (pre.length > 40) break;
      // Valuations ("at $15B valuation") are not the amount raised.
      if (/\bat\s+(?:about\s+|around\s+|roughly\s+|a\s+)?$/i.test(pre) || /^\s*(?:valuation|value)\b/i.test(tail)) continue;
      if (NOT_A_ROUND_TAIL_RE.test(tail) || FUND_TAIL_RE.test(tail)) return null;
      const company = cleanCompany(before);
      if (!company || company.split(" ").length > 6 || FUND_SUBJECT_RE.test(company)) return null; // long prefixes are sentences, not names
      const amount = parseAmount(am);
      if (amount == null) return null;
      const rm = t.match(ROUND_RE);
      const round = rm ? rm[1].replace(/\s+/g, " ").replace(/^./, (c) => c.toUpperCase()).replace(/\b(series|seed)\b/gi, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : "";
      return { company, amount_usd: Math.round(amount), round };
    }
  }
  return null;
}

// AI-native keywords on word boundaries, so "Thai" and "said" never match.
const AI_RE = /\bai\b|\bai-[a-z]+|\bgenai\b|\bgenerative\b|artificial intelligence|\bllms?\b|machine learning|deep learning|\bagents?\b|\bagentic\b|\bmodels?\b|\brobots?\b|\brobotics?\b|\bautonomous\b|computer vision|\bchatbots?\b|\bgpt\b|neural/i;

function isAI(title, summary) {
  return AI_RE.test(String(title || "") + " " + String(summary || ""));
}

// "RevRag" and "RevRag AI" are one company, as are "Modal" and "Modal Labs Inc". Dedupe keys only; never shown.
const SUFFIX_WORDS = new Set(["ai", "labs", "lab", "inc", "incorporated", "ltd", "llc", "corp", "corporation", "co", "pvt", "private", "limited", "technologies", "technology", "gmbh", "plc"]);
function normCompany(c) {
  const words = String(c || "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
  while (words.length > 1 && SUFFIX_WORDS.has(words[words.length - 1])) words.pop();
  return words.join("").replace(/[^a-z0-9]/g, "").replace(/(.{3,})ai$/, "$1");
}

// parseDeal can return a descriptor instead of a name ("Danish startup", "Former Plaud exec",
// "Oxford AI chip startup", "London's Obsero"). Only proper-noun names may be shown in the Top line.
const GENERIC_WORDS = new Set([
  "startup", "startups", "start-up", "firm", "company", "companies", "maker", "unicorn", "platform", "provider", "developer",
  "exec", "executive", "executives", "founder", "founders", "cofounder", "co-founder", "former", "ex", "ceo", "team", "researchers",
  "this", "these", "a", "an", "its", "his", "her", "their",
  "american", "british", "canadian", "chinese", "danish", "dutch", "european", "finnish", "french", "german", "indian",
  "irish", "israeli", "italian", "japanese", "korean", "nigerian", "norwegian", "polish", "singaporean", "spanish",
  "swedish", "swiss", "australian", "brazilian", "estonian", "vietnamese", "african", "emirati", "saudi",
]);
const CONNECTORS = new Set(["&", "and", "of", "the", "de", "la", "for"]);
function isNamedCompany(c) {
  const s = String(c || "").trim();
  if (!/^[A-Z]/.test(s) || /[,:;]/.test(s) || s.split(/\s+/).length > 4) return false;
  return s.split(/\s+/).every((w) => {
    const lw = w.toLowerCase();
    if (GENERIC_WORDS.has(lw) || /(?:'|’)s$/.test(lw) || /-(?:based|backed|founded|led|old)$/.test(lw)) return false;
    return CONNECTORS.has(lw) || /^[A-Z0-9]/.test(w);
  });
}

// deals: rows for the report week. prior: rows from the weeks before, so a round reported again
// (a later article about the same raise) is not counted a second time.
function weekMoney(deals, ytd, prior = []) {
  const seenBefore = new Set((prior || []).map((d) => normCompany(d.company)).filter(Boolean));
  const best = new Map();
  for (const d of deals || []) {
    if (!(d.amount_usd > 0)) continue;
    if (d.amount_usd > SUSPICIOUS_USD) {
      process.stderr.write(`money: excluded suspicious deal ${d.company} ${d.amount_usd} (item ${d.item_id})\n`);
      continue;
    }
    const named = isNamedCompany(d.company);
    // Descriptors cannot be matched by name, so the same round under two descriptors is matched by amount.
    const key = named ? normCompany(d.company) || d.item_id : "unnamed:" + Math.round(d.amount_usd / 1e4);
    if (named && seenBefore.has(key)) continue;
    const cur = best.get(key);
    if (!cur || d.amount_usd > cur.amount_usd) best.set(key, { ...d, named });
  }
  // "Oxford AI chip startup raises $125m" and "Salience Labs raises $125M" are one round: an unnamed deal
  // whose amount matches a named one is dropped. Rarely this drops a distinct deal; undercounting is the safe side.
  const namedAmounts = [...best.values()].filter((d) => d.named).map((d) => d.amount_usd);
  const uniq = [...best.values()].filter((d) => d.named || !namedAmounts.some((a) => Math.abs(a - d.amount_usd) <= a * 0.01));
  const total = uniq.reduce((n, d) => n + d.amount_usd, 0);
  const top = uniq
    .filter((d) => d.named)
    .sort((a, b) => b.amount_usd - a.amount_usd)
    .slice(0, 2)
    .map((d) => ({ company: d.company, amount_usd: d.amount_usd, item_id: d.item_id }));
  const y = ytd || {};
  return {
    total_usd: total,
    count: uniq.length,
    top,
    pct_of_ytd: y.amount_usd ? Math.round((total / y.amount_usd) * 1000) / 10 : null,
    ytd_label: y.label || null,
    ytd_period: y.period || null,
    ytd_source: y.source || null,
  };
}

// Compact money: "$2.1B", "$600M", "$40M", "$850K". One decimal only when under 10 and not whole.
function formatUSD(n) {
  const fmt = (v, suffix) => {
    const r = Math.round(v * 10) / 10;
    return "$" + (v < 10 && !Number.isInteger(r) ? r.toFixed(1) : Math.round(v)) + suffix;
  };
  if (n >= 1e9) return fmt(n / 1e9, "B");
  if (n >= 1e6) return fmt(n / 1e6, "M");
  if (n >= 1e3) return fmt(n / 1e3, "K");
  return "$" + Math.round(n);
}

module.exports = { parseDeal, isAI, weekMoney, formatUSD, isNamedCompany, normCompany, FX_TO_USD, SUSPICIOUS_USD };
