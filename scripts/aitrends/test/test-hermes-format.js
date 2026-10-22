// The report must survive Hermes's Markdown-to-WhatsApp conversion with its bold intact.
// hermesFormat is a port of format_message in /opt/hermes/gateway/platforms/whatsapp_common.py
// (italic rule first, then bold), copied from pmjobs-drop/test/test-hermes-format.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { forHermes } = require("../report");
const { renderReport } = require("../build");
const { data } = require("./fixture-week");

let fails = 0;
const check = (n, ok, info = "") => {
  console.log((ok ? "ok   " : "FAIL ") + n + (ok || !info ? "" : ": " + info));
  if (!ok) fails++;
};
const hermesFormat = (s) =>
  s
    .replace(/(?<!\*)\*(?!\s|\*)([^*\n]*?\S[^*\n]*?)\*(?!\*)/g, "_$1_")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "*$1*")
    .replace(/~~(.+?)~~/g, "~$1~");

const DOT = String.fromCharCode(0xb7);
for (const wa of [`*AI This Week ${DOT} 9-15 Nov*`, "_Sources: AI lab blogs and news feeds, week of 9-15 Nov._", "*If you build products*", "*_bold italic_*"]) {
  check("round trip: " + wa.slice(0, 40), hermesFormat(forHermes(wa)) === wa);
}
check("without forHermes Hermes turns bold into italic", hermesFormat("*Money*") === "_Money_");

const reportJs = path.join(__dirname, "..", "report.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aitrends-hf-"));
const stored = renderReport(data);
fs.writeFileSync(path.join(tmp, "report.txt"), stored + "\n");
const env = { ...process.env, AITRENDS_HOME: tmp };
const printed = execFileSync(process.execPath, [reportJs], { env, encoding: "utf8" }).trimEnd();
const delivered = hermesFormat(printed);
check("report arrives in WhatsApp exactly as stored", delivered === stored);
check("titles arrive bold", delivered.startsWith("*AI This Week") && delivered.includes("*Story of the week*"));
check("footer arrives italic", delivered.includes("_Sources: AI lab blogs"));
check("printed form doubles bold stars", printed.includes("**Money**"));

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "aitrends-hf-"));
const none = execFileSync(process.execPath, [reportJs], { env: { ...process.env, AITRENDS_HOME: empty }, encoding: "utf8" }).trim();
check("missing report message", none === "No AI report yet. The first one appears after Monday's run.", none);

// A Monday run that failed: the file is one week and a few hours old. Must already carry the banner.
const lateMonday = new Date(Date.now() - 7.6 * 24 * 3600e3);
fs.utimesSync(path.join(tmp, "report.txt"), lateMonday, lateMonday);
const late = hermesFormat(execFileSync(process.execPath, [reportJs], { env, encoding: "utf8" }).trimEnd());
check("stale banner the Monday after a failed run", late.startsWith("_This report is from 9-15 Nov; this week's update did not run._"), late.slice(0, 120));
const fresh = new Date(Date.now() - 6.9 * 24 * 3600e3);
fs.utimesSync(path.join(tmp, "report.txt"), fresh, fresh);
check("no banner within the week", !execFileSync(process.execPath, [reportJs], { env, encoding: "utf8" }).includes("did not run"));

const old = new Date(Date.now() - 9 * 24 * 3600e3);
fs.utimesSync(path.join(tmp, "report.txt"), old, old);
const stale = hermesFormat(execFileSync(process.execPath, [reportJs], { env, encoding: "utf8" }).trimEnd());
check("stale banner after 8 days", stale.startsWith("_This report is from 9-15 Nov; this week's update did not run._\n\n*AI This Week"), stale.slice(0, 120));
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });

if (fails) {
  console.log(fails + " FAILED");
  process.exit(1);
}
console.log("ALL PASS");
