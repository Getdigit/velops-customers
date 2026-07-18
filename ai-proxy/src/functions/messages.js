// VelOps CUSTOMER AI proxy — Azure Function (Node v4 programming model).
// Deployed as its own Function App ("velops-customer-ai"), separate from the
// internal hub's proxy: own function key, own CORS origin, own spend caps.
//
// The ONLY job of this Function is to hold the Anthropic API key and forward
// the browser's Claude Messages request to api.anthropic.com. It does NO
// Dataverse work — every Dataverse action is executed in the browser by the
// customer portal SPA with the signed-in portal user's own permissions
// (Power Pages table permissions enforce account scoping server-side).
//
// Why a backend at all: the Anthropic key must never reach the browser bundle
// (Vite inlines env vars and dist/ is fully extractable), and api.anthropic.com
// rejects browser origins. So the key lives in this Function's App Settings (or
// a Key Vault reference) and only ever sits server-side.
//
// Access control (v1): authLevel 'function' requires a function key in the
// request (?code=...). NOTE: the portal SPA bundle is served to signed-in
// portal users, so the key is semi-public — treat it as revocable and cheap to
// rotate, keep the model on Sonnet with capped max_tokens, and alert on spend
// (see docs/SECURITY.md). PRODUCTION HARDENING (fast-follow): App Service
// Authentication (Easy Auth) or a lightweight session check, then authLevel
// 'anonymous' with the auth layer gating the request.
const { app } = require('@azure/functions');

// Enable HTTP response streaming so we can pipe Anthropic's SSE back to the
// browser as it arrives (the agent loop streams the assistant's text).
app.setup({ enableHttpStream: true });

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

function corsHeaders(origin) {
  // Power Apps code apps run from an environment-specific origin
  // (https://<env>.environment.api.powerplatformusercontent.com), which varies
  // per environment — so we don't hard-code it. Access control is the function
  // key (in the ?code= URL), not CORS, so:
  //  - If ALLOWED_ORIGINS lists this exact origin, allow it WITH credentials
  //    (strict mode, e.g. for an Easy-Auth/cookie setup).
  //  - Otherwise reflect the caller's origin WITHOUT credentials. The client
  //    sends no credentials, so reflecting any origin is safe (CORS only governs
  //    whether the browser may read the response; the key still gates access).
  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (configured.length && origin && configured.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  return headers;
}

app.http('messages', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  handler: async (request, context) => {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return { status: 204, headers: cors };
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        status: 500,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { message: 'ANTHROPIC_API_KEY is not configured on the Function App.' } }),
      };
    }

    const payload = await request.text();

    let upstream;
    try {
      upstream = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: payload,
      });
    } catch (err) {
      context.error('Anthropic request failed', err);
      return {
        status: 502,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ error: { message: 'Upstream request to Anthropic failed.' } }),
      };
    }

    const contentType = upstream.headers.get('content-type') || 'application/json';

    // Stream the SSE body straight through (status + content-type preserved).
    if (contentType.includes('text/event-stream') && upstream.body) {
      return {
        status: upstream.status,
        headers: { ...cors, 'content-type': contentType, 'cache-control': 'no-cache' },
        body: upstream.body,
      };
    }

    // Non-streaming (or an Anthropic error): forward the JSON verbatim.
    const text = await upstream.text();
    return {
      status: upstream.status,
      headers: { ...cors, 'content-type': contentType },
      body: text,
    };
  },
});
