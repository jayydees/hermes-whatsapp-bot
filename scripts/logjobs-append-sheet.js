#!/usr/bin/env node
/**
 * Append logjobs CSV rows to Google Sheet tab `jobs`.
 * Dedupes on messageId via sidecar JSON next to the CSV.
 *
 * Usage:
 *   node logjobs-append-sheet.js
 *   node logjobs-append-sheet.js /opt/data/whatsapp/group_logs/jobs-preview.csv
 *
 * Env / defaults:
 *   SHEET_ID          spreadsheet id (required; also read from HERMES_ENV_FILE)
 *   SHEET_TAB         tab name (must be jobs)
 *   GOOGLE_SA_KEY     path to service-account JSON
 *   HERMES_ENV_FILE   .env to read SHEET_ID from (default /opt/data/.env)
 *   SENT_IDS_PATH     sidecar of already-appended messageIds
 *
 * CSV expected columns (header row):
 *   date,pushName,title,company,location,type,apply,excerpt,messageId
 * Extra columns (chatId, fromMe, senderId, ...) are ignored for the Sheet
 * but messageId is required for dedupe.
 */

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

// SHEET_ID comes from the environment, else from a SHEET_ID= line in the
// Hermes .env (the terminal tool may not pass .env values to child processes).
function envFileValue(key, file = process.env.HERMES_ENV_FILE || "/opt/data/.env") {
  try {
    for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
      const line = raw.replace(/\r/g, "").trim();
      if (line.startsWith(key + "=")) {
        return line.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
      }
    }
  } catch {}
  return "";
}
const SHEET_ID = process.env.SHEET_ID || envFileValue("SHEET_ID");
const SHEET_TAB = process.env.SHEET_TAB || "jobs";
const KEY_PATH =
  process.env.GOOGLE_SA_KEY || "/opt/data/secrets/google-sa.json";
const CSV_PATH =
  process.argv[2] || "/opt/data/whatsapp/group_logs/jobs-preview.csv";
const SENT_PATH =
  process.env.SENT_IDS_PATH ||
  path.join(path.dirname(CSV_PATH), "jobs-sent-ids.json");

const SHEET_COLS = [
  "date",
  "pushName",
  "title",
  "company",
  "location",
  "type",
  "apply",
  "excerpt",
];

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

function parseCsv(text) {
  const rows = [];
  let i = 0;
  let field = "";
  let row = [];
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    pushField();
    pushRow();
  }
  return rows;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function pemToDer(pem) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(b64, "base64");
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const keyObj = crypto.createPrivateKey({
    key: sa.private_key,
    format: "pem",
  });
  const sig = crypto.sign("sha256", Buffer.from(unsigned), keyObj);
  const jwt = `${unsigned}.${b64url(sig)}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await res.json();
  if (!json.access_token) {
    die("token error: " + JSON.stringify(json));
  }
  return json.access_token;
}

function rowToSheetValues(obj) {
  return SHEET_COLS.map((k) => (obj[k] == null ? "" : String(obj[k])));
}

async function main() {
  if (!SHEET_ID) die("SHEET_ID is not set");
  if (!fs.existsSync(CSV_PATH)) die("CSV missing: " + CSV_PATH);
  if (!fs.existsSync(KEY_PATH)) die("SA key missing: " + KEY_PATH);

  const raw = fs.readFileSync(CSV_PATH, "utf8");
  const table = parseCsv(raw);
  if (table.length < 2) {
    console.log(JSON.stringify({ ok: true, appended: 0, skipped: 0, reason: "no data rows" }));
    return;
  }
  const headers = table[0].map((h) => String(h).trim());
  const idx = {};
  headers.forEach((h, i) => {
    idx[h] = i;
  });
  if (idx.messageId == null) {
    die("CSV has no messageId column; cannot dedupe. Headers: " + headers.join(","));
  }

  const sentDoc = loadJson(SENT_PATH, { messageIds: [] });
  const sent = new Set(sentDoc.messageIds || []);

  const toAppend = [];
  const newIds = [];
  let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const rec = table[r];
    const mid = String(rec[idx.messageId] || "").trim();
    if (!mid) {
      skipped++;
      continue;
    }
    if (sent.has(mid)) {
      skipped++;
      continue;
    }
    const obj = {};
    for (const col of SHEET_COLS) {
      obj[col] = idx[col] != null ? rec[idx[col]] || "" : "";
    }
    // skip empty title+excerpt (not a job)
    if (!String(obj.title || "").trim() && !String(obj.excerpt || "").trim()) {
      skipped++;
      continue;
    }
    toAppend.push(rowToSheetValues(obj));
    newIds.push(mid);
  }

  if (!toAppend.length) {
    console.log(
      JSON.stringify({
        ok: true,
        appended: 0,
        skipped,
        sheet: SHEET_TAB,
        csv: CSV_PATH,
      })
    );
    return;
  }

  const sa = loadJson(KEY_PATH);
  const token = await getAccessToken(sa);
  const range = encodeURIComponent(`${SHEET_TAB}!A:H`);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: toAppend }),
  });
  const out = await res.json();
  if (!res.ok) die("sheets append failed: " + JSON.stringify(out));

  for (const id of newIds) sent.add(id);
  fs.writeFileSync(
    SENT_PATH,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        messageIds: Array.from(sent),
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify({
      ok: true,
      appended: toAppend.length,
      skipped,
      updatedRange: out.updates && out.updates.updatedRange,
      sentIdsPath: SENT_PATH,
    })
  );
}

main().catch((e) => die(String(e && e.stack ? e.stack : e)));
