// READ-ONLY: confirm the LIVE bundle has the AI proxy wired in — i.e. that the
// last sync-spa-bundle built WITH VITE_AI_PROXY_URL set. Fetches every
// assets/*.js the site references and checks that the proxy host string is
// present in at least one chunk (config.ts inlines it at build time).
// Usage (CI): node scripts/verify-bundle-ai.mjs   [PORTAL_URL=...]

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");
const HOST_NEEDLE = "velops-customer-ai.azurewebsites.net";

async function get(path) {
  const res = await fetch(`${PORTAL_URL}${path}`, { headers: { "User-Agent": "velops-smoke/1.0" } });
  return { status: res.status, text: await res.text().catch(() => "") };
}

async function main() {
  const home = await get("/");
  const assets = [...home.text.matchAll(/\/?assets\/[A-Za-z0-9_.-]+\.js/g)].map((m) => m[0]);
  // The AssistantPage chunk is lazy-loaded, so it is not referenced from index.html;
  // discover it from the main bundle's dynamic-import list too.
  const mainRef = assets.find((a) => /index-/.test(a));
  const extra = [];
  if (mainRef) {
    const main = await get(mainRef.startsWith("/") ? mainRef : `/${mainRef}`);
    for (const m of main.text.matchAll(/["'`](?:\.?\/)?assets\/[A-Za-z0-9_.-]+\.js["'`]/g)) {
      extra.push(m[0].replace(/["'`]/g, ""));
    }
  }
  const all = [...new Set([...assets, ...extra].map((a) => (a.startsWith("/") ? a : `/${a.replace(/^\.\//, "")}`)))];

  let found = false;
  let scanned = 0;
  for (const a of all) {
    const chunk = await get(a);
    if (chunk.status !== 200) continue;
    scanned++;
    if (chunk.text.includes(HOST_NEEDLE)) { found = true; console.error(`  ${a}: contains proxy host`); }
  }

  console.log(JSON.stringify({ pass: found, scannedChunks: scanned, needle: HOST_NEEDLE, portal: PORTAL_URL }));
  if (!found) {
    console.error(`FAIL: '${HOST_NEEDLE}' not found in any of ${scanned} JS chunks — the live bundle was built without VITE_AI_PROXY_URL.`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(`FATAL: ${err?.message || err}`); process.exit(1); });
