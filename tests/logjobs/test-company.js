// Offline fixtures for the company guesser. Regexes copied from scripts/logjobs-extract.js.
// Run: node tests/logjobs/test-company.js   (synthetic job-post text, no real messages)
function oneLine(s){return String(s||"").replace(/\s+/g," ").trim().slice(0,240);}
function stripHashtags(s){return String(s||"").replace(/#[\w]+/g," ").replace(/\s+/g," ").trim();}
const ROLE_RE=/((?:senior|sr\.?|lead|junior|jr\.?|principal|staff|associate)?\s*(?:product|program|project|engineering|software|backend|front[- ]?end|full[- ]?stack|data|qa|quality|marketing|sales|design|growth|business|operations|technical)\s*(?:manager|engineer|developer|designer|lead|analyst|intern(?:ship)?|scientist|architect|consultant|associate)s?)/i;
const COMPANY_STOP=/^(we|we're|were|i|our|the|a|an|is|are|am|to|for|and|looking|look|join|hiring|hire|apply|role|position|be|building|now|team|as|with|of|in|on|at|this|it|its|new|great|amazing|exciting|us|strong)$/i;

const PRONOUN=/^(we|i|they|it|he|she|you|our|us)$/i;
const BARE_ROLE=/^(manager|engineer|developer|designer|analyst|intern|internship|lead|associate|scientist|architect|consultant|role|position|team)$/i;
const HIRE_VERB="(?:hiring|looking|growing|expanding|scaling|recruiting|building)";

function normCompany(raw){
  let words=oneLine(raw).replace(/[|,.\s]+$/,"").split(/\s+/).filter(Boolean);
  const drop=(w)=>COMPANY_STOP.test(w)||/^(am|pm|\d{1,2}(:\d{2}){0,2})\.?$/i.test(w);
  while(words.length&&drop(words[0]))words.shift();
  while(words.length&&drop(words[words.length-1]))words.pop();
  let c=words.join(" ").trim();
  if(!c)return "";
  c=c.replace(/\.(com|io|in|ai|co|org|net|xyz|dev)$/i,"");
  if(/^[a-z0-9.\-]+$/.test(c))c=c.charAt(0).toUpperCase()+c.slice(1);
  return c.replace(/[,.]+$/,"").trim();
}

function validCompany(c){
  if(!c)return "";
  if(PRONOUN.test(c))return "";
  if(ROLE_RE.test(c))return "";
  const w=c.split(/\s+/);
  if(w.length===1&&BARE_ROLE.test(w[0]))return "";
  return c;
}

function guessCompany(text){
  const t=stripHashtags(text);
  // 1. Trusted "Role | Company" pipe.
  const pipe=t.match(/([A-Za-z][A-Za-z0-9 /+&#.\-]{2,50})\s*\|\s*([A-Za-z][A-Za-z0-9&.\- ]{1,40})/);
  if(pipe&&ROLE_RE.test(pipe[1])){const c=validCompany(normCompany(pipe[2]));if(c)return c;}
  // 2. "at|@|join <Company>": precise, so try before the looser verb patterns.
  const at=t.match(/(?:@|\bat|\bjoin)\s+([A-Z][A-Za-z0-9.&\-]*(?:\s+[A-Z][A-Za-z0-9.&\-]*){0,3})/);
  if(at){const c=validCompany(normCompany(at[1]));if(c)return c;}
  // 3a. "<brand>.com is/are <verb>": lowercase domain.
  const dom=t.match(new RegExp("\\b([a-z0-9][a-z0-9\\-]*\\.(?:com|io|in|ai|co|org|net))\\s+(?:is|are)\\s+"+HIRE_VERB,"i"));
  if(dom){const c=validCompany(normCompany(dom[1]));if(c)return c;}
  // 3b. "<Company> is/are <verb>": capitalised subject.
  const cap=t.match(new RegExp("([A-Z][A-Za-z0-9.&\\-]*(?:\\s+[A-Z][A-Za-z0-9.&\\-]*){0,3})\\s+(?:is|are)\\s+"+HIRE_VERB));
  if(cap){const c=validCompany(normCompany(cap[1]));if(c)return c;}
  // 3c. lowercase brand at a sentence boundary ("... illumine is growing").
  const low=t.match(new RegExp("(?:^|[.!?:]\\s+|\\n)([a-z][a-z0-9\\-]{2,})\\s+(?:is|are)\\s+"+HIRE_VERB));
  if(low){const c=validCompany(normCompany(low[1]));if(c)return c;}
  return "";
}

const cases=[
  // [label, text, expected company]
  ["role pipe company","🚀 We're Hiring: Product Manager | Acme Labs | Gurugram Acme Labs builds payroll software","Acme Labs"],
  ["sharer name after pipe"," | Jane Doe",""],
  ["at Company","Hiring Program Managers (Growth) at Northwind! Looking for 3 operators to own growth programs end to end","Northwind"],
  ["lowercase domain is hiring","https://lnkd.in/example examplenews.com is hiring a Product Manager - Growth","Examplenews"],
  ["lowercase brand at boundary","Hiring Alert for Product Managers. brightpath is growing its product team in Bangalore.","Brightpath"],
  ["@ Company","We're Hiring: Senior Product Manager - Custom Objects @ Contoso We're looking for a Senior Product Manager","Contoso"],
  ["Cap subject is hiring","🚀 Globex is hiring for a Senior Product Manager role!!","Globex"],
  ["hiring at multiword","🚀 We're hiring at Initech Business India! Looking for a Senior Product Manager","Initech Business India"],
  ["multiword subject","Orange Valley Labs is hiring a Product Manager and a Senior Engineering Manager About us:","Orange Valley Labs"],
  ["time artifact stripped","Posted 4:42:34 AM. Umbrella is building a screen-free AI companion for kids","Umbrella"],
  ["role with no company","🚀 Hiring: Lead Product Manager We are looking for a strong Product Manager to join a technology-focused team. Location: Hyderabad",""],
];
let fail=0;
for(const [n,t,exp] of cases){
  const got=guessCompany(t);
  const ok=got===exp;
  if(!ok)fail++;
  console.log((ok?"PASS ":"FAIL ")+n.padEnd(28)+"=> "+JSON.stringify(got)+(ok?"":"  (expected "+JSON.stringify(exp)+")"));
}
console.log(fail===0?"ALL OK":fail+" FAILURES");
process.exit(fail===0?0:1);
