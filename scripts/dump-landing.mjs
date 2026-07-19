// READ-ONLY: dump the landing page HTML of the live portal (head + all script/
// link/meta references) so we can see WHAT the Home page actually serves.
// Usage (CI): node scripts/dump-landing.mjs   [PORTAL_URL=https://...]

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");

const res = await fetch(`${PORTAL_URL}/`, {
  redirect: "follow",
  headers: { "User-Agent": "velops-smoke/1.0 (+github-actions)" },
});
const html = await res.text();

console.log(`status: ${res.status}  final-url: ${res.url}  length: ${html.length}`);
console.log("--- script/link/meta/title tags ---");
for (const m of html.matchAll(/<(script|link|meta|title)\b[^>]*>[^<]*(?:<\/(?:script|title)>)?/gi)) {
  console.log(m[0].replace(/\s+/g, " ").slice(0, 300));
}
console.log("--- first 3000 chars of body ---");
const bodyStart = html.search(/<body/i);
console.log(html.slice(bodyStart >= 0 ? bodyStart : 0, (bodyStart >= 0 ? bodyStart : 0) + 3000));
