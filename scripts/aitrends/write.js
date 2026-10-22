// The two Gemini calls of the weekly run: SELECT (pick and sort the week's stories) and
// EXPLAIN (write one short fact-checked line per pick). Code, not the model, enforces the rules.
const { checkLine, checkNames } = require("./lib/verify");

const SECTIONS = ["policy", "research", "security", "physical_ai", "build", "business", "invest"];
const CAPS = { policy: 4, research: 2, security: 2, physical_ai: 2, build: 2, business: 2, invest: 3 };
const REGIONS = ["EU", "USA", "UK", "India", "Other"];
const ITEM_CAP = 400;
const LINE_MAX = 140;
const STORY_MAX = 320;

const SELECT_SYSTEM = `You are the editor of a weekly AI news digest read on WhatsApp by busy professionals.
You receive the week's news items as JSON and choose which ones go in the digest.
Return JSON only, in exactly this shape:
{"story":{"id":"...","corroborating_ids":[]},
 "policy":[{"id":"...","region":"EU|USA|UK|India|Other","corroborating_ids":[]}],
 "research":[{"id":"...","corroborating_ids":[]}],
 "security":[...],"physical_ai":[...],"build":[...],"business":[...],"invest":[...]}
Rules:
- Only items about AI. Skip everything else.
- One entry per real-world event. Pick the best-sourced item as "id" and list other items about the same event in "corroborating_ids".
- An event appears in only ONE section.
- story = the single most consequential launch or development of the week.
- policy: laws, regulation, government action on AI. Set region to EU, USA, UK, India or Other.
- research: genuinely significant papers or results, not routine arXiv postings.
- security: breaches, hacks, jailbreaks, models escaping sandboxes or misbehaving.
- physical_ai: robots, humanoids, autonomous vehicles.
- build: new models, tools, APIs and product features relevant to people who build products.
- business: agents, automation, enterprise adoption, policy effects for businesses.
- invest: acquisitions, notable funding implications, job-market signals. Do NOT report funding totals; code computes those.
- Caps: policy 4, research 2, security 2, physical_ai 2, build 2, business 2, invest 3. Empty arrays are fine.
- Never invent ids. Use only ids from the input.`;

const EXPLAIN_SYSTEM = `You write one-line summaries for a weekly AI news digest read on WhatsApp.
Return JSON only: {"lines":[{"id":"...","text":"..."}],"story_text":"...","deal_notes":[{"item_id":"...","text":"..."}]}
Readers have zero context: they do not know any model, product, lab or technical term unless the line tells them.
Rules for each line:
- Every line has two parts: WHAT happened, then SO WHAT. Form: "<Thing> (<who>): <what it is>; <so what>" or "<who> <did what> (<so what>)".
- The SO WHAT part (40-60 characters) is mandatory on every line. It says how the thing differs, why it matters, or its practical impact (cost, speed, who can now do what, who it affects, what the buyer gains). For a new model, product or technical term it must make sense to a reader who has never heard of it.
- Acquisitions and deals: say what the buyer gets or why it wants the company. Policy lines: say who is affected and how.
- The SO WHAT must be grounded in the item text: an effect the text states or directly implies (for example "runs on a laptop, so no API bills"). Never speculate about markets, stock prices, winners or the future.
- The whole line is at most 140 characters. No full stop at the end of a line.
- Use ONLY facts in the item text you were given. Copy every number exactly as written there; never round, convert or compute one.
- Use ONLY names of companies, products, people and places that appear in the item text. Never guess who made something.
- Items with a "region" field go in the Policy section, which already prints the region before the line. Do not start those lines with the region or country (write "Delays high-risk AI rules", not "EU delays high-risk AI rules").
- Plain words only: no hype (revolutionary, game-changing, groundbreaking, unprecedented, cutting-edge), no em dashes, no asterisks.
story_text: 2-3 sentences, at most 320 characters, for a reader with zero context: sentence 1 says what was released or happened and by whom; sentence 2 says how it differs from what existed; sentence 3 says why it matters to people who build products or run businesses. Same fact rules. Base it on "story_id" and "story_background".
deal_notes: for each entry in "top_deals", a 2-5 word description of what the company does (for example "warehouse robots"), taken from its text.
Write a line for every entry in "items". Use the same ids you were given.`;

const REWRITE_SYSTEM = `You fix lines for a weekly AI news digest. Each entry below failed a fact check; "problems" says why.
Rewrite each text so the problems are gone. Use ONLY facts in "source". Remove any number or name not in "source". No hype words, no em dashes, no asterisks.
Line entries: at most 140 characters, each with its so-what part. The entry with id "story": 2-3 sentences, at most 320 characters.
Return JSON only: {"lines":[{"id":"...","text":"..."}]} with the same ids.`;

// Bullet lines never end with a full stop (the story paragraph keeps its sentences).
const noStop = (s) => s.replace(/\.\s*$/, "");
const tidy = (s) =>
  String(s == null ? "" : s)
    .replace(/\u2014/g, ", ")
    .replace(/[\ufeff\u200b\u200d*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const itemText = (it) => `${it.title || ""}. ${it.summary || ""}`;

async function selectItems(items, { callGemini, apiKey }) {
  const sent = [...items].sort((a, b) => String(b.published || "").localeCompare(String(a.published || ""))).slice(0, ITEM_CAP);
  const byId = new Map(sent.map((it) => [it.id, it]));
  const payload = sent.map((it) => ({
    id: it.id,
    section_hint: it.section_hint,
    source_name: it.source_name,
    published: it.published,
    title: it.title,
    summary: String(it.summary || "").slice(0, 300),
  }));
  const raw = await callGemini({ system: SELECT_SYSTEM, prompt: JSON.stringify({ items: payload }), apiKey });
  return enforce(raw || {}, byId);
}

// Applies the hard rules to the model's raw selection: known ids, no id reused across
// sections (story first, then SECTIONS order), security needs 2+ sources, caps.
function enforce(raw, byId) {
  const used = new Set();
  // Returns the cleaned entry, or null when its main id is unknown or already used.
  const plan = (entry) => {
    if (!entry || !byId.has(entry.id) || used.has(entry.id)) return null;
    const corr = [];
    for (const c of Array.isArray(entry.corroborating_ids) ? entry.corroborating_ids : []) {
      if (c !== entry.id && byId.has(c) && !used.has(c) && !corr.includes(c)) corr.push(c);
    }
    return { id: entry.id, corroborating_ids: corr };
  };
  const claim = (p) => [p.id, ...p.corroborating_ids].forEach((i) => used.add(i));

  const out = { story: null };
  const story = plan(raw.story);
  if (story) {
    claim(story);
    out.story = story;
  }
  for (const section of SECTIONS) {
    const list = [];
    for (const entry of Array.isArray(raw[section]) ? raw[section] : []) {
      if (list.length >= CAPS[section]) break;
      const p = plan(entry);
      if (!p) continue;
      if (section === "security" && new Set([p.id, ...p.corroborating_ids].map((i) => byId.get(i).source_name)).size < 2) continue;
      claim(p);
      if (section === "policy") p.region = REGIONS.includes(entry.region) ? entry.region : "Other";
      list.push(p);
    }
    out[section] = list;
  }
  return out;
}

// selection: output of selectItems. itemsById: Map or plain object of id -> item.
// topDeals: [{ company, item_id }] from weekMoney, so each gets a short description.
async function explainItems(selection, itemsById, { callGemini, apiKey, topDeals = [] }) {
  const get = (id) => (itemsById instanceof Map ? itemsById.get(id) : itemsById[id]);
  const view = (it) => ({ title: it.title, summary: it.summary, source_name: it.source_name });
  const storyId = selection.story ? selection.story.id : null;

  const entries = []; // one per selected item: { id, item, source }
  const add = (id, corr = []) => {
    const it = get(id);
    if (it) entries.push({ id, item: it, source: [it, ...corr.map(get).filter(Boolean)].map(itemText).join(" ") });
  };
  if (selection.story) add(storyId, selection.story.corroborating_ids);
  for (const s of SECTIONS) for (const e of selection[s] || []) add(e.id);
  const sourceOf = new Map(entries.map((e) => [e.id, e.source]));
  const regionOf = new Map((selection.policy || []).map((e) => [e.id, e.region]));

  const deals = topDeals.filter((d) => get(d.item_id));
  const payload = {
    items: entries.filter((e) => e.id !== storyId).map((e) => ({ id: e.id, ...(regionOf.has(e.id) ? { region: regionOf.get(e.id) } : {}), ...view(e.item) })),
    story_id: storyId,
    story_background: storyId ? [storyId, ...selection.story.corroborating_ids].map(get).filter(Boolean).map(view) : [],
    top_deals: deals.map((d) => ({ item_id: d.item_id, company: d.company, ...view(get(d.item_id)) })),
  };
  const raw = (await callGemini({ system: EXPLAIN_SYSTEM, prompt: JSON.stringify(payload), apiKey })) || {};

  const lines = new Map();
  for (const l of Array.isArray(raw.lines) ? raw.lines : []) {
    if (l && sourceOf.has(l.id) && l.id !== storyId && typeof l.text === "string") lines.set(l.id, noStop(tidy(l.text)));
  }
  let storyText = storyId && typeof raw.story_text === "string" ? tidy(raw.story_text) : "";

  // Fact check: numbers, names, style. A rewrite request covers every failure at once, and runs at most once.
  const verify = (text, source, max) => {
    const problems = [...checkLine(text, source, { max }).problems, ...checkNames(text, source).problems];
    return { ok: problems.length === 0, problems };
  };
  const failures = [];
  const test = (key, id, text, max) => {
    const r = verify(text, sourceOf.get(id), max);
    if (!r.ok) failures.push({ id: key, text, problems: r.problems, source: sourceOf.get(id) });
  };
  for (const [id, text] of lines) test(id, id, text, LINE_MAX);
  if (storyText) test("story", storyId, storyText, STORY_MAX);

  if (failures.length) {
    const re = (await callGemini({ system: REWRITE_SYSTEM, prompt: JSON.stringify({ failures }), apiKey })) || {};
    const fixes = new Map();
    for (const l of Array.isArray(re.lines) ? re.lines : []) if (l && typeof l.text === "string") fixes.set(l.id, l.id === "story" ? tidy(l.text) : noStop(tidy(l.text)));
    for (const f of failures) {
      const isStory = f.id === "story";
      const fixed = fixes.get(f.id);
      const r = fixed ? verify(fixed, f.source, isStory ? STORY_MAX : LINE_MAX) : { ok: false, problems: ["no rewrite returned"] };
      if (r.ok) {
        if (isStory) storyText = fixed;
        else lines.set(f.id, fixed);
      } else {
        process.stderr.write(`dropped ${isStory ? "story text" : "item " + f.id}: ${r.problems.join("; ")}\n`);
        if (isStory) storyText = "";
        else lines.delete(f.id);
      }
    }
  }

  const dealNotes = {};
  for (const n of Array.isArray(raw.deal_notes) ? raw.deal_notes : []) {
    if (!n || typeof n.text !== "string" || !deals.some((d) => d.item_id === n.item_id)) continue;
    const text = tidy(n.text);
    // Numbers are checked against nothing (a note carries none); names must come from the deal's own item.
    if (text && checkLine(text, "", { max: 40 }).ok && checkNames(text, itemText(get(n.item_id))).ok) dealNotes[n.item_id] = text;
  }
  return { lines: Object.fromEntries(lines), story_text: storyText, deal_notes: dealNotes };
}

// Joins the selection with its verified lines into the structure build.js renders.
function assemble(selection, explained) {
  const sections = {};
  for (const s of SECTIONS) {
    sections[s] = (selection[s] || [])
      .filter((e) => explained.lines[e.id])
      .map((e) => (s === "policy" ? { region: e.region, text: explained.lines[e.id] } : { text: explained.lines[e.id] }));
  }
  return { storyText: explained.story_text || "", sections };
}

module.exports = { selectItems, explainItems, assemble, enforce, SECTIONS, CAPS };
