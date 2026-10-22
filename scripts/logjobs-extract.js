#!/usr/bin/env node
/**
 * Read group JSONL for a day, write jobs-preview.csv (stable columns).
 * For lnkd.in / linkedin URLs, fetch public og:title + og:description.
 * Usage: node logjobs-extract.js [today|YYYY-MM-DD]
 */

const fs = require("fs");
const path = require("path");

const LOG_DIR = process.env.GROUP_LOG_DIR || "/opt/data/whatsapp/group_logs";
const OUT = process.env.JOBS_CSV || path.join(LOG_DIR, "jobs-preview.csv");

const HEADER = [
  "date",
  "pushName",
  "title",
  "company",
  "location",
  "type",
  "apply",
  "excerpt",
  "messageId",
  "chatId",
  "fromMe",
  "senderId",
];

// Hiring INTENT only: a lone job-noun ("sales", "the hiring manager…") is just
// chat in a real group. looksJob also demands a role phrase or apply channel.
const HIRE_INTENT_RE =
  /\b(hiring|we'?re looking|looking for|looking to hire|opening(s)?( for)?|vacanc(y|ies)|job description|\bjd\b|stipend|apply|send (your )?(cv|resume)|internship|intern\b)\b/i;
const GREET_RE =
  /^(gm|gn|good morning|good night|hi+|hey+|hello|ok|okay|thanks|thank you|yo+)\b[.\!\s]*$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LN_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|lnkd\.in)\//i;

function dayArg() {
  const a = (process.argv[2] || "today").trim().toLowerCase();
  if (a === "today" || a === "") return new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    console.error("bad day: " + a);
    process.exit(1);
  }
  return a;
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function oneLine(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function decodeEnt(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCharCode(parseInt(n, 16))
    );
}

function textOf(rec) {
  return [rec.body, rec.quotedText].filter(Boolean).join("\n");
}

function looksJob(rec) {
  const text = textOf(rec).trim();
  if (!text) return false;
  if (rec.fromMe === true || rec.fromMe === "true") return false;
  if (GREET_RE.test(text)) return false;
  if (LN_RE.test(text)) return true;
  // Typed text needs TWO signals: hiring intent AND a concrete role or apply
  // channel. One keyword alone is career chat, not a JD (false positives seen in a real group).
  if (!HIRE_INTENT_RE.test(text)) return false;
  return (
    ROLE_RE.test(text) ||
    (text.match(EMAIL_RE) || []).length > 0 ||
    (text.match(URL_RE) || []).length > 0
  );
}

function meta(html, prop) {
  const p = prop.replace(":", "\\:");
  const re = new RegExp(
    "<meta[^>]+(?:property|name)=[\"']" +
      p +
      "[\"'][^>]*\\scontent=([\"'])([\\s\\S]*?)\\1",
    "i"
  );
  const re2 = new RegExp(
    "<meta[^>]+content=([\"'])([\\s\\S]*?)\\1[^>]*(?:property|name)=[\"']" +
      p +
      "[\"']",
    "i"
  );
  const m = html.match(re) || html.match(re2);
  return m ? decodeEnt(m[2]) : "";
}
async function fetchOg(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; logjobs/1.0)" },
    });
    const html = await res.text();
    return {
      title: meta(html, "og:title") || meta(html, "twitter:title"),
      description: meta(html, "og:description"),
      finalUrl: res.url || url,
    };
  } catch {
    return { title: "", description: "", finalUrl: url };
  } finally {
    clearTimeout(t);
  }
}

function stripHashtags(s) {
  return String(s || "")
    .replace(/#[\w]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Match a real job-title phrase anywhere in the text (most reliable signal:
// job vocabulary, not a person's name / hashtag / city from og:title).
const ROLE_RE =
  /((?:senior|sr\.?|lead|junior|jr\.?|principal|staff|associate)?\s*(?:product|program|project|engineering|software|backend|front[- ]?end|full[- ]?stack|data|qa|quality|marketing|sales|design|growth|business|operations|technical)\s*(?:manager|engineer|developer|designer|lead|analyst|intern(?:ship)?|scientist|architect|consultant|associate)s?)/i;

function guessTitle(text) {
  const t = stripHashtags(text);
  // 1. Trusted "Role | Company" pipe (only when the left side is role-like).
  const pipe = t.match(
    /([A-Za-z][A-Za-z0-9 /+&#.\-]{2,50})\s*\|\s*[A-Za-z]/
  );
  if (pipe && ROLE_RE.test(pipe[1])) {
    return oneLine(pipe[1])
      .replace(/^.*?hiring[:\s-]*/i, "")
      .replace(/^\W+/, "")
      .replace(/[,.]+$/, "");
  }
  // 2. A concrete role phrase (Senior Product Manager, Backend Engineer, ...).
  const role = t.match(ROLE_RE);
  if (role) return oneLine(role[1]).trim();
  // 3. Fallback: whatever follows "hiring/looking for" up to punctuation.
  const m = t.match(
    /(?:looking for|hiring for|opening for|hiring|role|position)\b(?!\s+at\b)\s*:?\s*(?:a|an|the)?\s*([A-Za-z][A-Za-z0-9 /+&#.\-]{2,50}?)(?:\s+(?:role|position|opportunity|opening)\b|[!?.,\n:–—@|(]|$)/i
  );
  if (m && !/^(at|in|for|the|a|an)\b/i.test(m[1].trim())) {
    return oneLine(m[1]).trim().replace(/[,.]+$/, "");
  }
  return "";
}

// Words that are never a company name, trimmed off the ends of a guess.
const COMPANY_STOP =
  /^(we|we're|were|i|our|the|a|an|is|are|am|to|for|and|looking|look|join|hiring|hire|apply|role|position|be|building|now|team|as|with|of|in|on|at|this|it|its|new|great|amazing|exciting|us|strong)$/i;

const PRONOUN = /^(we|i|they|it|he|she|you|our|us)$/i;
const BARE_ROLE =
  /^(manager|engineer|developer|designer|analyst|intern|internship|lead|associate|scientist|architect|consultant|role|position|team)$/i;
const HIRE_VERB =
  "(?:hiring|looking|growing|expanding|scaling|recruiting|building)";

function normCompany(raw) {
  let words = oneLine(raw)
    .replace(/[|,.\s]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  // drop filler words / time artifacts a broad capture may have grabbed
  const drop = (w) =>
    COMPANY_STOP.test(w) || /^(am|pm|\d{1,2}(:\d{2}){0,2})\.?$/i.test(w);
  while (words.length && drop(words[0])) words.shift();
  while (words.length && drop(words[words.length - 1])) words.pop();
  let c = words.join(" ").trim();
  if (!c) return "";
  c = c.replace(/\.(com|io|in|ai|co|org|net|xyz|dev)$/i, ""); // examplenews.com -> examplenews
  if (/^[a-z0-9.\-]+$/.test(c)) c = c.charAt(0).toUpperCase() + c.slice(1); // lowercase brand -> Capitalised
  return c.replace(/[,.]+$/, "").trim();
}

// Reject a "company" that is really a pronoun or a job title.
function validCompany(c) {
  if (!c) return "";
  if (PRONOUN.test(c)) return "";
  if (ROLE_RE.test(c)) return "";
  const w = c.split(/\s+/);
  if (w.length === 1 && BARE_ROLE.test(w[0])) return "";
  return c;
}

function guessCompany(text) {
  const t = stripHashtags(text);
  // 1. Trusted "Role | Company" pipe.
  const pipe = t.match(
    /([A-Za-z][A-Za-z0-9 /+&#.\-]{2,50})\s*\|\s*([A-Za-z][A-Za-z0-9&.\- ]{1,40})/
  );
  if (pipe && ROLE_RE.test(pipe[1])) {
    const c = validCompany(normCompany(pipe[2]));
    if (c) return c;
  }
  // 2. "at|@|join <Company>": precise, so try before the looser verb patterns.
  const at = t.match(
    /(?:@|\bat|\bjoin)\s+([A-Z][A-Za-z0-9.&\-]*(?:\s+[A-Z][A-Za-z0-9.&\-]*){0,3})/
  );
  if (at) {
    const c = validCompany(normCompany(at[1]));
    if (c) return c;
  }
  // 3a. "<brand>.com is/are <verb>": lowercase domain (examplenews.com).
  const dom = t.match(
    new RegExp(
      "\\b([a-z0-9][a-z0-9\\-]*\\.(?:com|io|in|ai|co|org|net))\\s+(?:is|are)\\s+" +
        HIRE_VERB,
      "i"
    )
  );
  if (dom) {
    const c = validCompany(normCompany(dom[1]));
    if (c) return c;
  }
  // 3b. "<Company> is/are <verb>": capitalised subject (Acme Labs, Globex).
  const cap = t.match(
    new RegExp(
      "([A-Z][A-Za-z0-9.&\\-]*(?:\\s+[A-Z][A-Za-z0-9.&\\-]*){0,3})\\s+(?:is|are)\\s+" +
        HIRE_VERB
    )
  );
  if (cap) {
    const c = validCompany(normCompany(cap[1]));
    if (c) return c;
  }
  // 3c. lowercase brand at a sentence boundary ("... brightpath is growing").
  const low = t.match(
    new RegExp(
      "(?:^|[.!?:]\\s+|\\n)([a-z][a-z0-9\\-]{2,})\\s+(?:is|are)\\s+" + HIRE_VERB
    )
  );
  if (low) {
    const c = validCompany(normCompany(low[1]));
    if (c) return c;
  }
  return "";
}

// LinkedIn login/marketing walls carry no real job data, so drop these rows.
function isLinkedInWall(url, desc) {
  if (/\/(signup|login|authwall|checkpoint)\b/i.test(String(url || ""))) {
    return true;
  }
  const d = String(desc || "");
  if (/\d[\d,]*\s*million\+?\s*members/i.test(d)) return true;
  if (/Manage your professional identity\. Build and engage/i.test(d)) {
    return true;
  }
  return false;
}

function guessLocation(text) {
  const cities = String(text || "").match(
    /\b(gurugram|gurgaon|bangalore|bengaluru|mumbai|delhi|noida|hyderabad|pune|chennai|remote(?:\s+india)?)\b/gi
  );
  if (cities && cities.length) return cities[0];
  if (/\bindia\b/i.test(text)) return "India";
  return "";
}
function guessType(text) {
  if (/\bintern(ship)?\b/i.test(text)) return "internship";
  if (/\bcontract\b/i.test(text)) return "contract";
  if (/\bpart[- ]?time\b/i.test(text)) return "part-time";
  if (/\bfull[- ]?time\b/i.test(text)) return "full-time";
  return "unknown";
}

function guessApply(text) {
  const urls = text.match(URL_RE) || [];
  const emails = text.match(EMAIL_RE) || [];
  return urls[0] || emails[0] || "";
}

function applyFromDesc(desc, fallback) {
  const urls = String(desc || "").match(URL_RE) || [];
  const applyish = urls.find((u) => /lnkd\.in\/g|jobs|apply/i.test(u));
  return applyish || fallback || urls[0] || "";
}

async function toRow(rec, day) {
  let text = textOf(rec);
  const pageUrl = guessApply(text);
  let fetched = 0;
  if (pageUrl && LN_RE.test(pageUrl)) {
    const og = await fetchOg(pageUrl);
    fetched = og.title || og.description ? 1 : 0;
    const finalUrl = og.finalUrl || pageUrl;
    // Login/marketing walls carry no real job, so drop the row.
    if (isLinkedInWall(finalUrl, og.description)) return null;
    const desc = og.description || "";
    // The description is the trustworthy source on shared posts; og:title is
    // often the sharer's name / hashtags / a city. Read title+company from the
    // description text, and only trust og:title via its "Role | Company" pipe.
    const body = desc + "\n" + text;
    const ogTitle = oneLine(og.title || "");
    const rowApply = applyFromDesc(desc, finalUrl);
    return {
      date: rec.day || day,
      pushName: rec.pushName || "",
      title: guessTitle(body) || guessTitle(ogTitle),
      company: guessCompany(body) || guessCompany(ogTitle),
      location: guessLocation(body),
      type: guessType(body),
      apply: rowApply,
      excerpt: oneLine(desc || text),
      messageId: rec.messageId || "",
      chatId: rec.chatId || "",
      fromMe: rec.fromMe === true || rec.fromMe === "true" ? "true" : "false",
      senderId: rec.senderId || "",
      _fetched: fetched,
    };
  }
  return {
    date: rec.day || day,
    pushName: rec.pushName || "",
    title: guessTitle(text),
    company: guessCompany(text),
    location: guessLocation(text),
    type: guessType(text),
    apply: pageUrl,
    excerpt: oneLine(text),
    messageId: rec.messageId || "",
    chatId: rec.chatId || "",
    fromMe: rec.fromMe === true || rec.fromMe === "true" ? "true" : "false",
    senderId: rec.senderId || "",
    _fetched: 0,
  };
}

async function main() {
  const day = dayArg();
  const jsonl = path.join(LOG_DIR, day + ".jsonl");
  if (!fs.existsSync(jsonl)) {
    console.log(JSON.stringify({ ok: false, error: "no jsonl", day, jsonl }));
    process.exit(2);
  }
  const seen = new Set();
  const rows = [];
  const lines = fs.readFileSync(jsonl, "utf8").split(/\n/);
  let scanned = 0;
  let fetched = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    scanned++;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!looksJob(rec)) continue;
    const id = String(rec.messageId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const row = await toRow(rec, day);
    if (!row) continue;
    fetched += row._fetched || 0;
    delete row._fetched;
    rows.push(row);
  }
  const out = [HEADER.join(",")].concat(
    rows.map((r) => HEADER.map((h) => csvEscape(r[h])).join(","))
  );
  fs.writeFileSync(OUT, out.join("\n") + "\n");
  console.log(
    JSON.stringify({
      ok: true,
      day,
      scanned,
      jobs: rows.length,
      fetched,
      csv: OUT,
    })
  );
}

main();
