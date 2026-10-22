// Runs every test-*.js in this folder (including ones added by other builders).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let fail = 0;
for (const f of fs.readdirSync(__dirname).filter((n) => /^test-.*\.js$/.test(n)).sort()) {
  const r = spawnSync(process.execPath, ["--no-warnings", path.join(__dirname, f)], { encoding: "utf8" });
  const lines = (r.stdout || "").trim().split("\n");
  console.log(f + ": " + lines.slice(-2).join(" | "));
  if (r.status !== 0) {
    fail++;
    console.log(lines.filter((l) => l.startsWith("FAIL")).join("\n"));
    if (r.stderr) console.log(r.stderr.trim().split("\n").slice(-5).join("\n"));
  }
}
console.log(fail === 0 ? "ALL OK" : fail + " TEST FILES FAILED");
process.exit(fail === 0 ? 0 : 1);
