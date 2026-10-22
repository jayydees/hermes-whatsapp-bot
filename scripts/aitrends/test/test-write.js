const { selectItems, explainItems, assemble } = require("../write");
let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const mk = (id, src, title, summary = "", published = "2026-11-10T10:00:00Z") => ({ id, feed: "f", section_hint: "", title, link: "http://x/" + id, published, summary, source_name: src });
const items = [
  mk("a", "OpenAI", "OpenAI launches Foo model", "Foo costs 40% less than Bar."),
  mk("a2", "Verge", "Foo model arrives", "Same launch, says Sam Altman."),
  mk("b", "Verge", "EU passes AI rule", "The EU passed a rule."),
  mk("c", "Wired", "Hack of Acme", "Acme was breached."),
  mk("c2", "Wired", "More on Acme hack", "Wired follow up."),
  mk("d", "Wired", "Robot Zed walks", "Zed is a robot."),
  mk("e", "TC", "Paper one", ""), mk("f", "TC", "Paper two", ""), mk("g", "TC", "Paper three", ""),
  mk("h", "TC", "Hack two", ""), mk("h2", "BBC", "Hack two again", ""),
  mk("i", "TC", "Policy 1"), mk("j", "TC", "Policy 2"), mk("k", "TC", "Policy 3"), mk("l", "TC", "Policy 4"), mk("m", "TC", "Policy 5"),
];
const byId = new Map(items.map((i) => [i.id, i]));

(async () => {
  // ---- SELECT enforcement
  let sentPrompt;
  const raw = {
    story: { id: "a", corroborating_ids: ["a2", "nope"] },
    policy: [
      { id: "b", region: "EU", corroborating_ids: [] },
      { id: "a", region: "USA", corroborating_ids: [] }, // reused as story id
      { id: "a2", region: "USA", corroborating_ids: [] }, // reused as story corroborating id
      { id: "ghost", region: "UK", corroborating_ids: [] }, // unknown
      { id: "i", region: "Mars", corroborating_ids: [] },
      { id: "j", region: "UK", corroborating_ids: [] },
      { id: "k", region: "India", corroborating_ids: [] },
      { id: "l", region: "Other", corroborating_ids: [] }, // beyond cap 4
    ],
    research: [{ id: "e", corroborating_ids: ["b"] }, { id: "f", corroborating_ids: [] }, { id: "g", corroborating_ids: [] }],
    security: [
      { id: "c", corroborating_ids: ["c2"] }, // one source only
      { id: "h", corroborating_ids: ["h2"] }, // two sources
    ],
    physical_ai: [{ id: "d", corroborating_ids: [] }],
    build: [{ id: "m", corroborating_ids: ["e"] }],
    business: "not an array",
  };
  const sel = await selectItems(items, { apiKey: "k", callGemini: async (o) => { sentPrompt = o.prompt; return raw; } });
  check("story kept, unknown corroborating dropped", sel.story.id === "a" && JSON.stringify(sel.story.corroborating_ids) === '["a2"]');
  check("policy: reused/unknown dropped, capped at 4 in order", JSON.stringify(sel.policy.map((p) => p.id)) === '["b","i","j","k"]', JSON.stringify(sel.policy));
  check("policy unknown region becomes Other", sel.policy[1].region === "Other" && sel.policy[0].region === "EU");
  check("research cap 2, corroborating id used in policy removed", sel.research.length === 2 && sel.research[0].corroborating_ids.length === 0);
  check("security with one source dropped", !sel.security.some((s) => s.id === "c"));
  check("security with two sources kept", sel.security.length === 1 && sel.security[0].id === "h");
  check("physical_ai kept", sel.physical_ai.length === 1);
  check("build entry keeps id, loses used corroborating id", sel.build[0].id === "m" && sel.build[0].corroborating_ids.length === 0, JSON.stringify(sel.build));
  check("non-array section becomes empty", Array.isArray(sel.business) && sel.business.length === 0 && sel.invest.length === 0);
  const all = [sel.story, ...["policy", "research", "security", "physical_ai", "build", "business", "invest"].flatMap((s) => sel[s])].flatMap((e) => [e.id, ...e.corroborating_ids]);
  check("no id used twice", new Set(all).size === all.length);
  check("prompt carries items", JSON.parse(sentPrompt).items.length === items.length && JSON.parse(sentPrompt).items[0].summary !== undefined);

  // cap at 400 newest first
  const many = Array.from({ length: 450 }, (_, n) => mk("x" + n, "S", "t" + n, "y".repeat(500), `2026-11-${String(1 + (n % 28)).padStart(2, "0")}T00:00:00Z`));
  let sent;
  await selectItems(many, { apiKey: "k", callGemini: async (o) => { sent = JSON.parse(o.prompt).items; return {}; } });
  check("caps at 400 and trims summary to 300", sent.length === 400 && sent[0].summary.length === 300 && sent[0].published >= sent[399].published);

  // ---- EXPLAIN: one failing line gets one rewrite, then dropped
  const selection = {
    story: { id: "a", corroborating_ids: ["a2"] },
    policy: [{ id: "b", region: "EU", corroborating_ids: [] }],
    research: [], security: [], physical_ai: [{ id: "d", corroborating_ids: [] }], build: [], business: [], invest: [],
  };
  const calls = [];
  const fake = async (o) => {
    calls.push(o);
    if (o.system.includes("fix lines")) {
      const f = JSON.parse(o.prompt).failures;
      return { lines: f.map((x) => (x.id === "b" ? { id: "b", text: "EU passes an AI rule" } : { id: x.id, text: "STILL 99% BAD" })) };
    }
    return {
      lines: [
        { id: "b", text: "EU passes AI rule worth 500 million" }, // bad number, fixed by rewrite
        { id: "d", text: "Zed (Acme): a robot that walks, a revolutionary step" }, // hype, rewrite still bad -> dropped
      ],
      story_text: "OpenAI launched Foo, which costs 40% less than Bar.",
      deal_notes: [{ item_id: "d", text: "walking robots" }, { item_id: "zzz", text: "ignored" }],
    };
  };
  const exp = await explainItems(selection, byId, { callGemini: fake, apiKey: "k", topDeals: [{ company: "Zed Inc", item_id: "d" }] });
  check("exactly two Gemini calls (explain + one batched rewrite)", calls.length === 2, String(calls.length));
  check("rewrite batches all failures with problems listed", (() => { const f = JSON.parse(calls[1].prompt).failures; return f.length === 2 && f.every((x) => x.problems.length && x.source); })());
  check("fixed line kept", exp.lines.b === "EU passes an AI rule");
  check("still-failing line dropped", exp.lines.d === undefined);
  check("good story text kept", exp.story_text.startsWith("OpenAI launched Foo"));
  check("deal note kept only for known deal item", exp.deal_notes.d === "walking robots" && !exp.deal_notes.zzz);
  const asm = assemble(selection, exp);
  check("assemble drops sections without lines", asm.sections.policy.length === 1 && asm.sections.policy[0].region === "EU" && asm.sections.physical_ai.length === 0);

  // story text failing twice is dropped; missing line is dropped
  const fake2 = async (o) => o.system.includes("fix lines") ? { lines: [] } : { lines: [], story_text: "Foo costs 99% less" };
  const exp2 = await explainItems(selection, byId, { callGemini: fake2, apiKey: "k" });
  check("story text failing rewrite dropped", exp2.story_text === "" && Object.keys(exp2.lines).length === 0);

  // all good: no rewrite call
  let n = 0;
  await explainItems(selection, byId, { apiKey: "k", callGemini: async () => (n++, { lines: [{ id: "b", text: "EU passes AI rule" }], story_text: "ok" }) });
  check("no rewrite when everything verifies", n === 1);

  // ---- Invented names: a line or story crediting a company absent from its source is rewritten once, then dropped.
  const namesCalls = [];
  const fakeNames = async (o) => {
    namesCalls.push(o);
    if (o.system.includes("fix lines")) {
      return { lines: [{ id: "b", text: "EU passes an AI rule" }, { id: "story", text: "Google launched Foo, which costs 40% less than Bar." }] };
    }
    return {
      lines: [{ id: "b", text: "EU passes AI rule drafted by Microsoft" }, { id: "d", text: "Zed robot walks on its own" }],
      story_text: "Anthropic launched Foo, which costs 40% less than Bar.",
    };
  };
  const expN = await explainItems(selection, byId, { callGemini: fakeNames, apiKey: "k" });
  const failed = JSON.parse(namesCalls[1].prompt).failures;
  check("invented names sent for rewrite with reason", failed.length === 2 && failed.every((f) => f.problems.some((p) => /name not in source/.test(p))), JSON.stringify(failed.map((f) => f.problems)));
  check("rewritten line without invented name kept", expN.lines.b === "EU passes an AI rule");
  check("line whose names are in source kept untouched", expN.lines.d === "Zed robot walks on its own");
  check("story text with invented company dropped after rewrite", expN.story_text === "");

  // Story text is checked against the story item plus its corroborating items, not other items.
  const expS = await explainItems(selection, byId, {
    apiKey: "k",
    callGemini: async (o) => (o.system.includes("fix lines") ? { lines: [] } : { lines: [], story_text: "Sam Altman says OpenAI launched Foo." }),
  });
  check("story names from corroborating item accepted", expS.story_text === "Sam Altman says OpenAI launched Foo.");

  // Deal notes: names must come from the deal's own item.
  const expD = await explainItems(selection, byId, {
    apiKey: "k",
    topDeals: [{ company: "Zed", item_id: "d" }, { company: "Acme", item_id: "c" }],
    callGemini: async () => ({ lines: [], deal_notes: [{ item_id: "d", text: "Tesla robot supplier" }, { item_id: "c", text: "breached retailer" }] }),
  });
  check("deal note with invented name dropped", expD.deal_notes.d === undefined && expD.deal_notes.c === "breached retailer", JSON.stringify(expD.deal_notes));

  // Policy items carry their region, so the model can avoid opening the line with it.
  let explainPayload;
  await explainItems(selection, byId, { apiKey: "k", callGemini: async (o) => ((explainPayload = JSON.parse(o.prompt)), {}) });
  check("policy item sent with region, others without", explainPayload.items.find((i) => i.id === "b").region === "EU" && explainPayload.items.find((i) => i.id === "d").region === undefined);

  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
