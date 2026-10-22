const { callGemini } = require("../lib/gemini");
let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const KEY = "SECRET-KEY-123";
const resp = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const good = (text) => resp(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] });

(async () => {
  // request shape
  let seen;
  const out = await callGemini({
    system: "SYS", prompt: "PROMPT", apiKey: KEY,
    fetchImpl: async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return good('{"a":1}'); },
  });
  check("returns parsed JSON", out.a === 1);
  check("url", seen.url === "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", seen.url);
  check("key in header only", seen.init.headers["x-goog-api-key"] === KEY && !seen.url.includes(KEY) && !seen.init.body.includes(KEY));
  check("body shape", seen.body.systemInstruction.parts[0].text === "SYS" && seen.body.contents[0].role === "user" &&
    seen.body.contents[0].parts[0].text === "PROMPT" && seen.body.generationConfig.responseMimeType === "application/json" &&
    seen.body.generationConfig.maxOutputTokens === 32768 && seen.body.generationConfig.temperature === 0.2 && seen.body.generationConfig.thinkingConfig.thinkingLevel === "low");
  check("timeout signal set", !!seen.init.signal);

  // joins text parts, ignores thoughtSignature parts
  const joined = await callGemini({ system: "s", prompt: "p", apiKey: KEY, fetchImpl: async () =>
    resp(200, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"x":' }, { thoughtSignature: "abc" }, { text: "2}" }] } }] }) });
  check("joins text parts, ignores thoughtSignature", joined.x === 2);

  // MAX_TOKENS
  let err = null;
  try { await callGemini({ system: "s", prompt: "p", apiKey: KEY, fetchImpl: async () => resp(200, { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"a"' }] } }] }) }); } catch (e) { err = e; }
  check("MAX_TOKENS throws", err && /MAX_TOKENS/.test(err.message));

  // unparseable
  err = null;
  try { await callGemini({ system: "s", prompt: "p", apiKey: KEY, fetchImpl: async () => good("not json") }); } catch (e) { err = e; }
  check("unparseable JSON throws", !!err);

  // retry on 429 then success, with 20 s sleep
  let calls = 0, slept = [];
  const r = await callGemini({ system: "s", prompt: "p", apiKey: KEY, sleep: async (ms) => slept.push(ms),
    fetchImpl: async () => (++calls === 1 ? resp(429, { error: "rate" }) : good('{"ok":true}')) });
  check("retry on 429 then success", r.ok === true && calls === 2 && slept[0] === 20000);

  // retry once only
  calls = 0; err = null;
  try { await callGemini({ system: "s", prompt: "p", apiKey: KEY, sleep: async () => {}, fetchImpl: async () => (calls++, resp(503, { error: "down" })) }); } catch (e) { err = e; }
  check("two 503s throw after exactly one retry", err && calls === 2 && /503/.test(err.message));

  // 401 immediate, key never in error text (even if the server echoes it)
  calls = 0; err = null;
  try { await callGemini({ system: "s", prompt: "p", apiKey: KEY, sleep: async () => { throw new Error("slept"); },
    fetchImpl: async () => (calls++, resp(401, { error: { message: "bad key " + KEY } })) }); } catch (e) { err = e; }
  check("401 throws immediately", err && calls === 1 && /401/.test(err.message));
  check("key never in error text", err && !err.message.includes(KEY), err && err.message);

  err = null;
  try { await callGemini({ system: "s", prompt: "p", apiKey: KEY, fetchImpl: async () => { throw new Error("network down " + KEY); }, sleep: async () => {} }); } catch (e) { err = e; }
  check("network error scrubbed", err && !err.message.includes(KEY) && /network down/.test(err.message), err && err.message);

  if (fails) { console.log(fails + " FAILED"); process.exit(1); }
  console.log("ALL PASS");
})();
