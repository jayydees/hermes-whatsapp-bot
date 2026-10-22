#!/usr/bin/env node
/**
 * Run extract + append and print ONE plain-English line for WhatsApp.
 * Usage: node logjobs-run.js [today|YYYY-MM-DD]
 * The bot pastes that line as-is, so the reply stays short and still cannot be
 * faked: no line exists unless both scripts actually ran.
 */

const { execFileSync } = require("child_process");

const EXTRACT = "/opt/data/scripts/logjobs-extract.js";
const APPEND = "/opt/data/scripts/logjobs-append-sheet.js";
const day = (process.argv[2] || "today").trim();

/** Run a script and parse the JSON it prints as its last line. */
function runJson(file, args) {
  let out;
  try {
    out = execFileSync("node", [file, ...args], { encoding: "utf8" });
  } catch (err) {
    // A failing script still prints its {"ok":false,...} line on stdout.
    out = err.stdout || "";
    const parsed = lastJson(out);
    if (parsed) return parsed;
    throw new Error(String(err.message || err).split("\n")[0]);
  }
  const parsed = lastJson(out);
  if (!parsed) throw new Error("no JSON from " + file);
  return parsed;
}

function lastJson(text) {
  const lines = String(text || "").trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {}
  }
  return null;
}

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

/** "today" or "17 Sep", from the extract's YYYY-MM-DD. */
function dayLabel(isoDay) {
  if (isoDay === new Date().toISOString().slice(0, 10)) return "today";
  const d = new Date(isoDay + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The one line the bot replies with. */
function summary(found, added, alreadyThere, when) {
  if (!found) return "No job posts found in " + when + "'s messages.";
  if (!added) {
    const which = found === 1 ? "The 1 job from " + when + " is" : "All " + found + " jobs from " + when + " are";
    return "No new jobs since the last run. " + which + " already in the sheet.";
  }
  const rest = alreadyThere ? " (" + alreadyThere + " more were already there)" : "";
  return "Added " + plural(added, "new job") + " from " + when + " to the sheet" + rest + ".";
}

function main() {
  const ex = runJson(EXTRACT, [day]);
  if (!ex.ok) {
    console.log("Couldn't read the chat log: " + (ex.error === "no jsonl" ? "no messages were logged that day." : ex.error || "unknown error"));
    process.exit(1);
  }
  const when = dayLabel(ex.day);
  if (!ex.jobs) {
    console.log(summary(0, 0, 0, when));
    return;
  }

  const ap = runJson(APPEND, []);
  if (!ap.ok) {
    console.log("Found " + plural(ex.jobs, "job") + " but couldn't write to the sheet: " + (ap.error || "unknown error"));
    process.exit(1);
  }
  console.log(summary(ex.jobs, ap.appended, ap.skipped, when));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.log("logjobs failed: " + String(err.message || err).slice(0, 200));
    process.exit(1);
  }
}

module.exports = { summary, dayLabel };
