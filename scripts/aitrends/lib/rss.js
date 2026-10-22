// RSS 2.0 + Atom parser. Regex based, no deps. Entities are decoded BEFORE tags are stripped,
// because feeds escape their HTML and stripping first would leave "&lt;a href=...&gt;" to resurface.
const crypto = require("node:crypto");

const SUMMARY_CAP = 1500;

function decodeOnce(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function unCdata(s) {
  return String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

// Plain text from a feed field: decode, strip tags, decode again (double-escaped feeds), collapse whitespace.
function toText(raw) {
  let out = unCdata(raw);
  for (let i = 0; i < 2; i++) out = decodeOnce(out).replace(/<[^>]*>/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

function field(block, name) {
  const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return m ? m[1] : "";
}

function atomLink(block) {
  const tags = block.match(/<link\b[^>]*>/gi) || [];
  let best = "";
  for (const t of tags) {
    const href = (t.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const rel = (t.match(/\brel\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!rel || rel === "alternate") return decodeOnce(href);
    if (!best) best = decodeOnce(href);
  }
  return best;
}

function toISO(s) {
  const t = toText(s);
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function parseFeed(xml, { name, section_hint, source_name } = {}) {
  const blocks = String(xml || "").match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const items = [];
  for (const b of blocks) {
    let title = toText(field(b, "title"));
    if (!title) continue;
    const isAtom = /^<entry\b/i.test(b);
    let link = isAtom ? atomLink(b) : toText(field(b, "link"));
    if (!link && !isAtom) link = atomLink(b);
    const published = toISO(field(b, "pubDate") || field(b, "published") || field(b, "updated") || field(b, "dc:date"));
    const summary = toText(field(b, "content:encoded") || field(b, "description") || field(b, "summary") || field(b, "content")).slice(0, SUMMARY_CAP);
    let src = source_name;
    const gnSource = toText(field(b, "source"));
    if (gnSource) {
      src = gnSource;
      // Google News appends " - Publisher" to every headline.
      const suffix = " - " + gnSource;
      // Some publishers already carry their own suffix (doubled) or leave a dangling " -".
      while (title.endsWith(suffix)) title = title.slice(0, -suffix.length).trim();
      title = title.replace(/\s+-+$/, "");
    }
    items.push({
      id: crypto.createHash("sha1").update(link || title).digest("hex"),
      feed: name,
      section_hint,
      title,
      link,
      published,
      summary,
      source_name: src,
    });
  }
  return items;
}

module.exports = { parseFeed, toText };
