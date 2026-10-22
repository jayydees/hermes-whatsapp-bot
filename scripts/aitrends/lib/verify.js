// Mechanical fact check for generated lines: every number must appear in the source text.
const UNIT = { trillion: 1e12, tn: 1e12, billion: 1e9, bn: 1e9, b: 1e9, million: 1e6, mn: 1e6, m: 1e6, crore: 1e7, lakh: 1e5, thousand: 1e3, k: 1e3, t: 1e12 };
const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const TOKEN = new RegExp(
  String.raw`(\d+\/\d+)(?:st|nd|rd|th)?` + // 1: fraction
    String.raw`|(${NUM})\s?[x×](?![a-z0-9])` + // 2: multiplier
    String.raw`|[$€₹£]?\s?(${NUM})(?:(\s?%|\s?per ?cent)|\s?(trillion|billion|million|thousand|crore|lakh|bn|mn|tn)\b|([bmkt])\b(?![-\w]))?`, // 3 number, 4 pct, 5 word unit, 6 letter unit
  "gi"
);
const HYPE = /\b(revolutionary|game[- ]changing|groundbreaking|unprecedented|cutting[- ]edge)\b/i;
const INVISIBLE = /[\ufeff\u200b\u200d]/;

const clean = (n) => parseFloat(n.replace(/,/g, ""));

function tokens(text) {
  const out = [];
  for (const m of String(text).matchAll(TOKEN)) {
    if (m[1]) out.push({ key: "f:" + m[1].replace(/\b0+(?=\d)/g, ""), shown: m[0].trim() });
    else if (m[2]) out.push({ key: "x:" + clean(m[2]), shown: m[0].trim() });
    else {
      let v = clean(m[3]);
      const unit = (m[5] || m[6] || "").toLowerCase();
      if (unit) v *= UNIT[unit];
      out.push({ key: (m[4] ? "p:" : "n:") + Number(v.toPrecision(12)), shown: m[0].trim() });
    }
  }
  return out;
}

function checkLine(text, sourceText, opts = {}) {
  const max = opts.max || 140;
  const problems = [];
  const have = new Set(tokens(sourceText).map((t) => t.key));
  for (const t of tokens(text)) if (!have.has(t.key)) problems.push(`number not in source: ${t.shown}`);
  if (text.includes("\u2014")) problems.push("contains em dash");
  if (INVISIBLE.test(text)) problems.push("contains invisible character");
  const hype = text.match(HYPE);
  if (hype) problems.push(`hype word: ${hype[0]}`);
  if (text.length > max) problems.push(`too long (${text.length} > ${max})`);
  return { ok: problems.length === 0, problems };
}

// Lenient name check: every capitalised word (company, product, person, place) in a generated line must
// appear in the source text, case-insensitive, at the start of a word. Catches invented entities such as
// a launch credited to the wrong lab. Sentence-initial words may also be common words ("Delays", "The"),
// so they pass on a short stopword list or when their stem is in the source.
const NAME_OK = new Set([
  "ai", "api", "apis", "gpu", "gpus", "cpu", "cpus", "tpu", "tpus", "llm", "llms", "ceo", "ceos", "cto", "cfo", "coo",
  "ipo", "vc", "vcs", "ml", "saas", "b2b", "r&d", "i", "ok",
  "eu", "us", "u.s", "usa", "uk", "india", "indian", "china", "chinese", "europe", "european", "america", "american", "britain", "british",
]);
const STARTERS = new Set([
  "a", "an", "the", "this", "that", "these", "those", "its", "it", "they", "new", "now", "more", "less", "most", "first",
  "how", "why", "what", "when", "who", "with", "without", "for", "from", "after", "before", "about", "by", "in", "on", "at",
  "to", "as", "and", "but", "so", "no", "not", "only", "one", "two", "all", "some", "each", "every", "users", "developers",
  "researchers", "companies", "firms", "startups", "teams", "people", "businesses", "lawmakers", "regulators", "officials",
]);
// Tokens below hold only letters, digits and . & ' so the dot is the one regex metacharacter to escape.
const escapeRe = (s) => s.replace(/[.]/g, "[.]");
const stem = (w) => (w.length > 4 ? w.replace(/(?:ies|es|ed|ing|s|d)$/, "") : w);

function checkNames(text, sourceText) {
  const src = String(sourceText || "").replace(/’/g, "'");
  const has = (w) => new RegExp("(?:^|[^a-z0-9])" + escapeRe(w), "i").test(src);
  const problems = [];
  const t = String(text || "").replace(/’/g, "'");
  for (const m of t.matchAll(/[A-Za-z0-9][A-Za-z0-9.&']*/g)) {
    const w = m[0].replace(/'s$/i, "").replace(/[.']+$/, "");
    if (!/^[A-Za-z]/.test(w) || !/[A-Z]/.test(w)) continue;
    const lw = w.toLowerCase();
    if (NAME_OK.has(lw) || has(lw)) continue;
    const initial = /(?:^|[.!?:;(]|["'])\s*$/.test(t.slice(0, m.index));
    if (initial && (STARTERS.has(lw) || has(stem(lw)))) continue;
    if (!problems.includes("name not in source: " + w)) problems.push("name not in source: " + w);
  }
  return { ok: problems.length === 0, problems };
}

module.exports = { checkLine, checkNames };
