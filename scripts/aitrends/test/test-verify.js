const { checkLine, checkNames } = require("../lib/verify");
let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const EM = String.fromCharCode(0x2014);
const ZW = String.fromCharCode(0x200b);

const ok = (text, src, name) => { const r = checkLine(text, src); check(name || "supported: " + text, r.ok, r.problems.join("; ")); };
const bad = (text, src, name) => { const r = checkLine(text, src); check(name || "unsupported: " + text, !r.ok && r.problems.length > 0, "wrongly ok"); };

ok("Acme raises $400M", "Acme has raised $400 million in a Series C");
ok("Acme raises 400 million dollars", "Acme raised $400M");
ok("Acme raises $400 million", "round of 400 million dollars");
ok("Cuts cost 40%", "costs fall 40 percent");
ok("Cuts cost 40 percent", "a 40% reduction");
ok("Uses 1/10th of the compute", "needs only 1/10th of the compute");
bad("Uses 1/10th of the compute", "needs a tenth of the compute");
ok("Runs 10x faster", "it is 10x faster");
bad("Runs 10x faster", "it is faster");
ok("Raised 1.2B", "raised 1.2 billion");
ok("Raised $2,100M", "raised $2.1 billion");
ok("Founded in 2024", "company founded in 2024");
bad("Acme raises $500M", "Acme raised $400 million");
bad("Cuts cost 45%", "costs fall 40 percent");
bad("Raised 400 crore", "raised 400 million");
ok("Raised 400 crore", "raised Rs 400 crore");
ok("Raised 3.5 lakh", "raised 3.5 lakh");
ok("No numbers here at all", "");
ok("Model with 70B parameters", "a 70B parameter model");
bad("Model with 7B parameters", "a 70B parameter model");

let r = checkLine("Fine " + EM + " dash", "Fine dash");
check("em dash flagged", !r.ok && r.problems.some((p) => /em dash/.test(p)));
r = checkLine("Fine" + ZW + " text", "Fine text");
check("invisible char flagged", !r.ok);
for (const w of ["revolutionary", "game-changing", "groundbreaking", "unprecedented", "cutting-edge", "Cutting edge"]) {
  r = checkLine("A " + w + " tool", "tool");
  check("hype word flagged: " + w, !r.ok);
}
r = checkLine("x".repeat(141), "");
check("141 chars too long", !r.ok && r.problems.some((p) => /too long/.test(p)));
check("140 chars ok", checkLine("x".repeat(140), "").ok);
check("141 chars fails", !checkLine("x".repeat(141), "").ok);
check("story limit 280 ok", checkLine("x".repeat(280), "", { max: 280 }).ok);
check("281 chars fails story limit", !checkLine("x".repeat(281), "", { max: 280 }).ok);

// ---- checkNames: capitalised names must appear in the source
const nOk = (text, src) => { const r = checkNames(text, src); check("names ok: " + text, r.ok, r.problems.join("; ")); };
const nBad = (text, src, name) => { const r = checkNames(text, src); check("names flagged: " + text, !r.ok && r.problems.some((p) => p.includes(name)), JSON.stringify(r.problems)); };
const SRC = "OpenAI launches Foo model. Foo costs 40% less than Bar. The EU delayed high-risk rules to 2028.";
nOk("OpenAI launches Foo (cheaper than Bar)", SRC);
nOk("Foo (OpenAI): 40% cheaper per token than Bar", SRC);
nOk("Delays high-risk AI rules to 2028", SRC); // sentence-initial verb, stem "delay" in source
nOk("The EU delays AI rules; US firms get more time", SRC); // region names and AI allowed
nOk("openai's Foo arrives", SRC);
nOk("OPENAI launches FOO", SRC); // case-insensitive
nOk("Meta’s Llama 5 runs on one GPU", "Meta released Llama 5, which fits on a single GPU");
nOk("GPT-5 tops the benchmark", "OpenAI said GPT-5 beat rivals");
nOk("New rules for AI agents", "rules for agents");
nBad("Anthropic launches Foo (cheaper than Bar)", SRC, "Anthropic"); // wrong company at sentence start
nBad("Foo (Google): cheaper than Bar", SRC, "Google");
nBad("OpenAI launches Foo with Microsoft", SRC, "Microsoft");
nBad("Apple buys Lumen", "pineapple grower Lumen expands", "Apple"); // must match at a word start
nBad("Foo beats Gemini Ultra", SRC, "Gemini");
check("names: empty source flags names", !checkNames("Acme ships Foo", "").ok);
check("names: line without names passes on empty source", checkNames("warehouse robots for retailers", "").ok);

if (fails) { console.log(fails + " FAILED"); process.exit(1); }
console.log("ALL PASS");
