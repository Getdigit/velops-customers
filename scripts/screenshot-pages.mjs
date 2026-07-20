// READ-ONLY: render key portal pages with the runner's headless Chrome and
// emit the PNGs base64-chunked between markers, so they can be extracted from
// the job log and viewed locally (the build container cannot reach the portal
// directly; CI runners can, and ubuntu-latest ships Chrome).
// Usage (CI): node scripts/screenshot-pages.mjs   [PORTAL_URL=https://...]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");
const PAGES = [
  ["landing", "/"],
  ["login", "/Account/Login"],
  ["signin", "/SignIn"],
  ["register", "/Account/Login/Register"],
];

const chrome = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium"].find((c) => {
  try {
    execFileSync("which", [c], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
});
if (!chrome) {
  console.error("no chrome/chromium binary found on this runner");
  process.exit(1);
}
console.error(`using ${chrome}`);

for (const [name, path] of PAGES) {
  const out = `/tmp/shot-${name}.png`;
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        `--window-size=1280,1400`,
        `--screenshot=${out}`,
        "--virtual-time-budget=15000",
        `${PORTAL_URL}${path}`,
      ],
      { stdio: "pipe", timeout: 60000 },
    );
  } catch (err) {
    console.error(`screenshot ${name} failed: ${String(err.message).slice(0, 300)}`);
    continue;
  }
  if (!existsSync(out)) {
    console.error(`screenshot ${name}: no output file`);
    continue;
  }
  const b64 = readFileSync(out).toString("base64");
  console.log(`BEGIN-PNG ${name} ${b64.length}`);
  for (let i = 0; i < b64.length; i += 2000) console.log(b64.slice(i, i + 2000));
  console.log(`END-PNG ${name}`);
}
console.error("done");
