// Prints the prebuilt weekly report. No DB access, so it returns fast.
//
// report.txt holds WhatsApp syntax (*bold*, _italic_). Hermes treats every outgoing message as
// Markdown before sending: a single *x* becomes _x_ (italic) and **x** becomes *x* (bold).
// So bold must leave here as **x** to arrive in WhatsApp as *x*.
const fs = require("fs");
const path = require("path");

const home = () => process.env.AITRENDS_HOME || "/opt/data/aitrends";
const DAY = 24 * 3600e3;

// Same match as Hermes's italic rule, so exactly the spans it would turn italic are doubled.
const SINGLE_STAR = /(?<!\*)\*(?!\s|\*)([^*\n]*?\S[^*\n]*?)\*(?!\*)/g;
const forHermes = (text) => text.replace(SINGLE_STAR, "**$1**");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function render() {
  const file = path.join(home(), "report.txt");
  if (!fs.existsSync(file)) return "No AI report yet. The first one appears after Monday's run.";
  let text = fs.readFileSync(file, "utf8").trimEnd();
  const mtime = fs.statSync(file).mtime;
  // The weekly run rewrites report.txt every Monday, so anything older than 7 days plus 12 hours of slack
  // for a late cron means this Monday's run failed. (Was 8 days, which hid a failed run for a whole day.)
  if (Date.now() - mtime.getTime() > 7.5 * DAY) {
    const head = text.match(/^\*AI This Week · ([^*\n]+)\*/);
    const d = new Date(mtime.getTime() + 19800000);
    const week = head ? head[1] : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
    text = `_This report is from ${week}; this week's update did not run._\n\n` + text;
  }
  return forHermes(text);
}

if (require.main === module) console.log(render());

module.exports = { forHermes, render };
