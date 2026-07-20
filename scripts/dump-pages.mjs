// READ-ONLY: dump what the PLATFORM pages of the live portal reference and
// which of those assets actually resolve. The SPA landing page is fine; the
// platform-rendered pages (sign-in, profile, access denied) looked unstyled —
// suspicion: our bundleFilePatterns deleted the default theme webfiles
// (bootstrap.min.css / portalbasictheme.css / theme.css) at upload time.
// Usage (CI): node scripts/dump-pages.mjs   [PORTAL_URL=https://...]

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");
const PAGES = ["/", "/Account/Login", "/profile", "/Access-Denied", "/Page-Not-Found"];

async function get(path) {
  const res = await fetch(`${PORTAL_URL}${path}`, {
    redirect: "follow",
    headers: { "User-Agent": "velops-smoke/1.0 (+github-actions)" },
  });
  return { status: res.status, url: res.url, text: await res.text().catch(() => "") };
}

const assetStatuses = new Map(); // path -> status

async function checkAsset(path) {
  if (assetStatuses.has(path)) return assetStatuses.get(path);
  const res = await fetch(`${PORTAL_URL}${path}`, {
    redirect: "manual",
    headers: { "User-Agent": "velops-smoke/1.0 (+github-actions)" },
  });
  const size = res.status === 200 ? (await res.text().catch(() => "")).length : 0;
  const result = `${res.status}${size ? ` (${size}b)` : ""}`;
  assetStatuses.set(path, result);
  return result;
}

for (const page of PAGES) {
  const r = await get(page);
  const title = (r.text.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim() ?? "?";
  console.log(`\n=== ${page} -> ${r.status}  (final: ${r.url})  title: ${title}  length: ${r.text.length}`);

  // Root-relative stylesheet/script references (site-hosted assets only).
  const refs = new Set();
  for (const m of r.text.matchAll(/(?:href|src)="(\/[^"]+\.(?:css|js))(?:\?[^"]*)?"/gi)) {
    if (!m[1].startsWith("//")) refs.add(m[1]);
  }
  for (const ref of refs) {
    console.log(`  asset ${ref} -> ${await checkAsset(ref)}`);
  }
}
console.log("\ndone");
