// Fixtures for the looksJob two-signal rule. Regexes copied from scripts/logjobs-extract.js.
// Run: node tests/logjobs/test-looksjob.js   (synthetic text, no real messages)
const HIRE_INTENT_RE =
  /\b(hiring|we'?re looking|looking for|looking to hire|opening(s)?( for)?|vacanc(y|ies)|job description|\bjd\b|stipend|apply|send (your )?(cv|resume)|internship|intern\b)\b/i;
const GREET_RE =
  /^(gm|gn|good morning|good night|hi+|hey+|hello|ok|okay|thanks|thank you|yo+)\b[.\!\s]*$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const LN_RE = /(?:https?:\/\/)?(?:www\.)?(?:linkedin\.com|lnkd\.in)\//i;
const ROLE_RE =
  /((?:senior|sr\.?|lead|junior|jr\.?|principal|staff|associate)?\s*(?:product|program|project|engineering|software|backend|front[- ]?end|full[- ]?stack|data|qa|quality|marketing|sales|design|growth|business|operations|technical)\s*(?:manager|engineer|developer|designer|lead|analyst|intern(?:ship)?|scientist|architect|consultant|associate)s?)/i;

function looksJob(text) {
  text = text.trim();
  if (!text) return false;
  if (GREET_RE.test(text)) return false;
  if (LN_RE.test(text)) return true;
  if (!HIRE_INTENT_RE.test(text)) return false;
  return (
    ROLE_RE.test(text) ||
    (text.match(EMAIL_RE) || []).length > 0 ||
    (text.match(URL_RE) || []).length > 0
  );
}

const cases = [
  // [expected, label, text]
  [true, "typed JD backend", "Hiring: Backend Engineer, 3+ years Node.js, remote India. Apply: jobs@example.com"],
  [true, "typed JD intern", "We are hiring a marketing intern. Stipend 15k. Bangalore, 3 months. JD: social + content."],
  [true, "typed JD qa", "Hiring: QA Engineer, 2 years, Pune. Apply: qa@example.com"],
  [true, "linkedin forward", "https://lnkd.in/p/example1"],
  [false, "group chat sales/marketing", "How do you do sales and marketing for a side project?\n\nAny advice"],
  [false, "group chat hiring manager", "Just move on. In my experience you often get the right signal during interviews, for example when the hiring manager only accepts one view of a solution."],
  [false, "greeting", "gm"],
  [false, "career question", "any internship tips for freshers?"],
  [false, "casual apply", "this rule doesn't apply to you"],
  [true, "JD with url", "We're looking for a Growth Analyst. Apply: https://forms.gle/abc"],
];

let fail = 0;
for (const [exp, label, text] of cases) {
  const got = looksJob(text);
  const ok = got === exp;
  if (!ok) fail++;
  console.log((ok ? "PASS" : "FAIL") + "  " + label + "  (expected " + exp + ", got " + got + ")");
}
console.log(fail === 0 ? "ALL OK" : fail + " FAILURES");
process.exit(fail === 0 ? 0 : 1);
