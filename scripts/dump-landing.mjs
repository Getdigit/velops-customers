// READ-ONLY: dump the landing page HTML of the live portal (head + all script/
// link/meta references) so we can see WHAT the Home page actually serves.
// Usage (CI): node scripts/dump-landing.mjs   [PORTAL_URL=https://...]

import tls from "node:tls";

const PORTAL_URL = (process.env.PORTAL_URL || "https://velopssupport.powerappsportals.com").replace(/\/+$/, "");

// TLS probe (no cert validation): which certificate does the endpoint serve?
const host = new URL(PORTAL_URL).hostname;
await new Promise((resolve) => {
  const sock = tls.connect(
    { host, port: 443, servername: host, rejectUnauthorized: false, timeout: 10000 },
    () => {
      const cert = sock.getPeerCertificate();
      console.log(`TLS probe for ${host}:`);
      console.log(`  subject CN : ${cert.subject?.CN}`);
      console.log(`  SANs       : ${cert.subjectaltname}`);
      console.log(`  issuer     : ${cert.issuer?.CN}`);
      console.log(`  valid      : ${cert.valid_from} -> ${cert.valid_to}`);
      sock.end();
      resolve();
    },
  );
  sock.on("error", (e) => { console.log(`TLS probe error: ${e.message}`); resolve(); });
  sock.on("timeout", () => { console.log("TLS probe timeout"); sock.destroy(); resolve(); });
});

async function fetchWithRetry(url, attempts = 4) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "velops-smoke/1.0 (+github-actions)" },
      });
    } catch (err) {
      lastErr = err;
      console.error(`fetch attempt ${i}/${attempts} failed: ${err?.cause?.code || err?.message || err}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 10000));
    }
  }
  throw new Error(`fetch failed after ${attempts} attempts: ${lastErr?.cause?.code || lastErr?.message}`);
}

const res = await fetchWithRetry(`${PORTAL_URL}/`);
const html = await res.text();

console.log(`status: ${res.status}  final-url: ${res.url}  length: ${html.length}`);
console.log("--- script/link/meta/title tags ---");
for (const m of html.matchAll(/<(script|link|meta|title)\b[^>]*>[^<]*(?:<\/(?:script|title)>)?/gi)) {
  console.log(m[0].replace(/\s+/g, " ").slice(0, 300));
}
console.log("--- first 3000 chars of body ---");
const bodyStart = html.search(/<body/i);
console.log(html.slice(bodyStart >= 0 ? bodyStart : 0, (bodyStart >= 0 ? bodyStart : 0) + 3000));
