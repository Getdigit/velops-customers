// Anonymous HTTP smoke test of the live Power Pages site, run from CI (the
// build container's proxy blocks powerappsportals.com; GitHub runners do not).
// No credentials involved — checks only what an anonymous visitor can see:
//   1. the landing page serves the SPA shell,
//   2. the referenced JS bundle downloads,
//   3. the platform login page is reachable,
//   4. the portal Web API refuses anonymous access,
//   5. gd_internalnotes is never readable (spec D1, from the outside).
// Usage (CI): node scripts/smoke-portal-http.mjs   [PORTAL_URL=https://...]

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.error(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function get(path, { redirect = "follow" } = {}) {
  const res = await fetch(`${PORTAL_URL}${path}`, {
    redirect,
    headers: { "User-Agent": "velops-smoke/1.0 (+github-actions)" },
  });
  const text = redirect === "manual" ? "" : await res.text().catch(() => "");
  return { status: res.status, text, url: res.url, location: res.headers.get("location") || "" };
}

// A request that lands on (or redirects to) a sign-in page — the portal's own
// /Account/Login or the Entra login of a Private-visibility site — counts as
// "access refused" for anonymous checks.
const AUTH_GATE_RE = /login\.microsoftonline\.com|login\.windows\.net|\/Account\/Login/i;
const isAuthGate = (r) =>
  AUTH_GATE_RE.test(r.url || "") ||
  AUTH_GATE_RE.test(r.location || "") ||
  /Sign in to your account/i.test(r.text || "");

async function main() {
  console.error(`Portal: ${PORTAL_URL}`);

  const home = await get("/");
  check("landing page returns 200", home.status === 200, `got ${home.status} (${home.url})`);
  const isSpa = /assets\/index-[^"']+\.js/.test(home.text) && /<div id="root">/.test(home.text);
  if (isAuthGate(home) && !isSpa) {
    // Site visibility is still Private (default for new sites): every anonymous
    // request is bounced to Entra sign-in. Not a data risk, but the public
    // branded landing page requires Public visibility (RUNBOOK).
    check("landing page serves the SPA shell (site visibility must be Public)", false,
      "anonymous visitors are redirected to Entra sign-in — set Site visibility to Public");
  } else {
    check("landing page serves the SPA shell (root div + hashed bundle)", isSpa,
      `title: ${(home.text.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "?"}, length ${home.text.length}`);
  }

  const assetPath = (home.text.match(/\/?assets\/index-[^"']+\.js/) || [null])[0];
  if (assetPath) {
    const asset = await get(assetPath.startsWith("/") ? assetPath : `/${assetPath}`);
    check("JS bundle downloads", asset.status === 200 && asset.text.length > 10000,
      `got ${asset.status}, ${asset.text.length} bytes`);
  } else {
    check("JS bundle downloads", false, isAuthGate(home) ? "skipped — landing page is behind the auth gate" : "no asset reference found on landing page");
  }

  const login = await get("/Account/Login");
  check("login page reachable (portal or Entra)", login.status === 200, `got ${login.status} (${login.url})`);

  // API checks with redirect:manual — a 30x to a sign-in page IS a refusal;
  // only a direct 200 with data would be a leak.
  const api = await get("/_api/gd_supporttickets", { redirect: "manual" });
  check("anonymous portal Web API access is refused",
    api.status === 401 || api.status === 403 || (api.status >= 300 && api.status < 400 && isAuthGate(api)),
    `got ${api.status} -> ${api.location || "(no location)"}`);

  const internal = await get("/_api/gd_internalnotes", { redirect: "manual" });
  check("gd_internalnotes NEVER readable anonymously (spec D1)", internal.status !== 200,
    `got ${internal.status} -> ${internal.location || "(no location)"}`);

  console.log(JSON.stringify({ pass: failures.length === 0, passed, failures, portal: PORTAL_URL }));
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`FATAL: ${err?.message || err}`);
  process.exit(1);
});
