// Monthly WhatsApp reminder (cron, 7th of each month) to refresh ytd.json, the
// "2026 so far" AI funding figure behind the /aitrends Money line. Prints one message;
// cron delivers stdout to the owner's DM. Lists recent Crunchbase funding recaps
// already collected, so the update is one click away.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const home = process.env.AITRENDS_HOME || "/opt/data/aitrends";
const ytd = JSON.parse(fs.readFileSync(path.join(__dirname, "ytd.json"), "utf8"));

// Monthly or quarterly recaps name a period ("September 2026", "Q3 2026", "H1", "year to date");
// weekly roundups ("The Week's 10 Biggest Funding Rounds") are not recaps.
const PERIOD = /\b(q[1-4]|h[12]|first half|year[- ]to[- ]date|ytd|20\d\d)\b/i;
const RECAP = { test: (t) => /\b(funding|venture)\b/i.test(t) && PERIOD.test(t) && !/\bweek/i.test(t) };

function recentRecaps(dbPath, days = 14) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    return db
      .prepare("SELECT title, link, published FROM items WHERE source_name = 'Crunchbase News' AND COALESCE(published, first_seen) >= ? ORDER BY COALESCE(published, first_seen) DESC")
      .all(since)
      .filter((r) => RECAP.test(r.title))
      .slice(0, 3);
  } finally {
    db.close();
  }
}

function message(recaps) {
  const lines = [
    // Hermes turns single-star bold into italic before sending; **x** arrives in WhatsApp as bold *x*.
    "**Monthly reminder: refresh the AI funding baseline**",
    `/aitrends uses ${ytd.label} (${ytd.source}, ${ytd.period}, as of ${ytd.as_of}) for the "2026 so far" %.`,
    "Ask Claude Code to update ytd.json from Crunchbase's latest monthly or quarterly recap.",
  ];
  if (recaps.length) {
    lines.push("", "**Recent Crunchbase recaps**");
    for (const r of recaps) lines.push(`• ${r.title}`, `  ${r.link}`);
  } else {
    lines.push("", "No Crunchbase recap collected in the last 14 days yet. Check news.crunchbase.com/venture.");
  }
  return lines.join("\n");
}

if (require.main === module) console.log(message(recentRecaps(path.join(home, "aitrends.db"))));

module.exports = { message, recentRecaps, RECAP };
