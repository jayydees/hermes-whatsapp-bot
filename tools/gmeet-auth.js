#!/usr/bin/env node
/**
 * One-time Google OAuth for /gmeet. Runs LOCALLY on the PC, never on the server.
 *
 *   node gmeet-auth.js url <client_secret.json>
 *   node gmeet-auth.js exchange <client_secret.json> "<pasted redirect URL or code>"
 *
 * Writes gmeet-token.json next to this script. Never prints client secrets.
 */

const fs = require("fs");
const path = require("path");

// Only what the gmeet plugin uses: create calendar events, and create Meet spaces
// (open links). No Gmail, Drive, or wider Calendar access is requested.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/meetings.space.created",
].join(" ");
const REDIRECT = "http://localhost:1";

function client(p) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    throw new Error("Could not read that file as JSON: " + p);
  }
  const c = raw.installed || raw.web;
  if (!c || !c.client_id) {
    const kind = raw.type === "service_account" ? " (this looks like a service-account key)" : "";
    throw new Error(
      "That is not a Desktop OAuth client JSON" +
        kind +
        ".\nRe-download from Google Cloud Console -> Credentials -> " +
        "Create Credentials -> OAuth client ID -> Application type: Desktop app."
    );
  }
  return c;
}

function authUrl(c) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", c.client_id);
  u.searchParams.set("redirect_uri", REDIRECT);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  return u.toString();
}

async function exchange(c, pasted) {
  let code = (pasted || "").trim();
  if (!code) throw new Error("No code or URL given. Paste the URL the browser failed on.");
  if (code.includes("code=")) {
    try {
      code = new URL(code).searchParams.get("code") || code;
    } catch {
      code = (code.match(/[?&]code=([^&]+)/) || [])[1] || code;
    }
  }
  code = decodeURIComponent(code);

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: c.client_id,
      client_secret: c.client_secret,
      redirect_uri: REDIRECT,
      grant_type: "authorization_code",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      "Google rejected the code: " +
        (j.error_description || j.error || "HTTP " + r.status) +
        "\nCodes expire fast and work once. Re-run the 'url' step and approve again."
    );
  }
  if (!j.refresh_token) {
    throw new Error(
      "Google returned no refresh_token. Re-run the 'url' step (it forces a fresh consent) and approve again."
    );
  }

  const outPath = path.join(__dirname, "gmeet-token.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        client_id: c.client_id,
        client_secret: c.client_secret,
        refresh_token: j.refresh_token,
        token_uri: "https://oauth2.googleapis.com/token",
      },
      null,
      2
    )
  );
  return outPath;
}

(async () => {
  const [, , mode, cpath, pasted] = process.argv;
  if (!mode || !cpath) {
    console.error('usage: gmeet-auth.js url|exchange <client.json> ["<url or code>"]');
    process.exit(1);
  }
  try {
    const c = client(cpath);
    if (mode === "url") {
      console.log(authUrl(c));
    } else if (mode === "exchange") {
      console.log("OK token written: " + (await exchange(c, pasted)));
    } else {
      throw new Error("Unknown mode: " + mode + " (use 'url' or 'exchange')");
    }
  } catch (e) {
    console.error("Error: " + e.message);
    process.exit(1);
  }
})();
