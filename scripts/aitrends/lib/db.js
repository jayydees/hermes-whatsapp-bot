const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, feed TEXT, section_hint TEXT, title TEXT, link TEXT,
  published TEXT, summary TEXT, source_name TEXT, first_seen TEXT);
CREATE TABLE IF NOT EXISTS deals(item_id TEXT, company TEXT, amount_usd REAL, round TEXT, published TEXT, title TEXT,
  PRIMARY KEY(item_id));
CREATE TABLE IF NOT EXISTS runs(run_at TEXT, feed TEXT, ok INT, items INT, error TEXT);
CREATE INDEX IF NOT EXISTS items_published ON items(published);
CREATE INDEX IF NOT EXISTS deals_published ON deals(published);`;

function open(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  // Twice-daily collect.sh and the weekly run's own collect can overlap; wait instead of failing "database is locked".
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec(SCHEMA);
  return db;
}

// first_seen and the feed/section_hint of the first sighting are never overwritten: the same story often
// appears in several feeds, and the earliest sighting decides which section it belongs to.
// The first known published date is kept too: with twice-daily collection a feed that bumps an entry's
// date (Atom <updated>) would otherwise move the item into a later week and report it a second time.
function upsertItem(db, it) {
  db.prepare(
    `INSERT INTO items(id, feed, section_hint, title, link, published, summary, source_name, first_seen)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, link=excluded.link,
       published=COALESCE(published, excluded.published), summary=excluded.summary, source_name=excluded.source_name`
  ).run(
    it.id, it.feed || "", it.section_hint || "", it.title || "", it.link || "", it.published || null,
    it.summary || "", it.source_name || "", it.first_seen || new Date().toISOString()
  );
}

function recordRun(db, r) {
  db.prepare("INSERT INTO runs(run_at, feed, ok, items, error) VALUES(?,?,?,?,?)").run(
    r.run_at || new Date().toISOString(), r.feed, r.ok ? 1 : 0, r.items || 0, r.error || null
  );
}

function upsertDeal(db, d) {
  db.prepare("INSERT OR REPLACE INTO deals(item_id, company, amount_usd, round, published, title) VALUES(?,?,?,?,?,?)").run(
    d.item_id, d.company || "", d.amount_usd, d.round || "", d.published || null, d.title || ""
  );
}

// Range is [fromISO, toISOExclusive). Items without a published date fall back to first_seen.
function itemsBetween(db, fromISO, toISOExclusive) {
  return db
    .prepare(
      `SELECT * FROM items WHERE COALESCE(published, first_seen) >= ? AND COALESCE(published, first_seen) < ?
       ORDER BY COALESCE(published, first_seen) DESC`
    )
    .all(fromISO, toISOExclusive);
}

function dealsBetween(db, fromISO, toISOExclusive) {
  return db
    .prepare("SELECT * FROM deals WHERE published >= ? AND published < ? ORDER BY published DESC")
    .all(fromISO, toISOExclusive);
}

module.exports = { open, upsertItem, recordRun, upsertDeal, itemsBetween, dealsBetween };
