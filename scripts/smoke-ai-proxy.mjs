// End-to-end smoke test of the deployed AI proxy (Function App velops-customer-ai),
// run from CI (the build container can't reach Azure; runners can). Verifies the
// WHOLE chain: function key -> proxy -> Anthropic key -> a real model response.
// Reads the same env the SPA build uses (run-script.yml passes them through):
//   VITE_AI_PROXY_URL  = https://velops-customer-ai.azurewebsites.net/api/messages
//   VITE_AI_PROXY_KEY  = the 'portal' function key (never printed)
// Usage (CI): node scripts/smoke-ai-proxy.mjs

const URL_BASE = (process.env.VITE_AI_PROXY_URL || "").trim();
const KEY = (process.env.VITE_AI_PROXY_KEY || "").trim();
const ORIGIN = "https://velopssupport.powerappsportals.com";

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.error(`  PASS  ${name}`); }
  else { failures.push(`${name}${detail ? ` — ${detail}` : ""}`); console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

function withKey(url) {
  if (!KEY) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}code=${encodeURIComponent(KEY)}`;
}

async function main() {
  console.error(`AI proxy: ${URL_BASE || "(VITE_AI_PROXY_URL not set)"}  keyPresent=${KEY ? "yes" : "no"}`);
  if (!URL_BASE) {
    console.log(JSON.stringify({ pass: false, reason: "VITE_AI_PROXY_URL not set — set repo variable AI_PROXY_URL (RUNBOOK stap ⑤)" }));
    process.exit(1);
  }
  if (!KEY) {
    console.log(JSON.stringify({ pass: false, reason: "VITE_AI_PROXY_KEY not set — set repo secret AI_PROXY_FUNCTION_KEY (RUNBOOK stap ⑤)" }));
    process.exit(1);
  }

  // 1. CORS preflight (proxy handles OPTIONS -> 204 with the allow headers).
  const pre = await fetch(withKey(URL_BASE), {
    method: "OPTIONS",
    headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  check("CORS preflight returns 204", pre.status === 204, `got ${pre.status}`);
  const allowOrigin = pre.headers.get("access-control-allow-origin") || "";
  check("preflight allows the portal origin", allowOrigin === ORIGIN || allowOrigin === "*", `got '${allowOrigin}'`);

  // 2. Real non-streaming Messages call — exercises the Anthropic key server-side.
  const body = {
    model: "claude-sonnet-4-6",
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
  };
  const res = await fetch(withKey(URL_BASE), {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  check("Messages call returns 200", res.status === 200, `got ${res.status}: ${text.slice(0, 200)}`);

  let json = null;
  try { json = JSON.parse(text); } catch { /* streaming or non-json */ }
  const replyText = json?.content?.map?.((b) => b.text || "").join(" ") || "";
  check("proxy forwarded a real model reply", /pong/i.test(replyText) || (json?.content?.length > 0),
    replyText ? `reply: "${replyText.slice(0, 80)}"` : `no content block (raw: ${text.slice(0, 120)})`);

  // 3. Wrong/absent key must be refused by the platform (401/403) — proves the
  //    function key actually gates access.
  const noKey = await fetch(URL_BASE, {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  check("call without the function key is refused", noKey.status === 401 || noKey.status === 403, `got ${noKey.status}`);

  console.log(JSON.stringify({ pass: failures.length === 0, passed, failures }));
  if (failures.length > 0) process.exit(1);
}

main().catch((err) => { console.error(`FATAL: ${err?.message || err}`); process.exit(1); });
