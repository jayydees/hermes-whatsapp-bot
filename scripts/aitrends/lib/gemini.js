// Minimal Gemini JSON-mode client. Returns the parsed JSON object or throws.
// The API key is sent only in the x-goog-api-key header and is scrubbed from every error.
const RETRY_STATUS = new Set([429, 500, 503]);
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini({
  system,
  prompt,
  apiKey,
  fetchImpl = fetch,
  model = "gemini-3.8-flash",
  maxOutputTokens = 32768, // Gemini 3.x spends output tokens on hidden thinking; 8192 truncated the selection call
  sleep = defaultSleep,
}) {
  if (!apiKey) throw new Error("Gemini API key missing");
  const scrub = (s) => (apiKey ? String(s).split(apiKey).join("[key]") : String(s));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens, temperature: 0.2, thinkingConfig: { thinkingLevel: "low" } },
  });

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    let failure = null;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      failure = new Error("Gemini request failed: " + scrub(e && e.message));
    }
    if (!failure && !res.ok) {
      let detail = "";
      try {
        detail = scrub(await res.text()).slice(0, 200);
      } catch (e) {}
      failure = new Error(`Gemini HTTP ${res.status}${detail ? ": " + detail : ""}`);
      if (!RETRY_STATUS.has(res.status)) throw failure;
    }
    if (!failure) break;
    if (attempt === 1) throw failure;
    await sleep(20000);
  }

  const data = await res.json();
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) throw new Error("Gemini returned no candidates");
  if (cand.finishReason === "MAX_TOKENS") throw new Error("Gemini output truncated (MAX_TOKENS)");
  const text = ((cand.content && cand.content.parts) || [])
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("Gemini returned unparseable JSON");
  }
}

module.exports = { callGemini };
