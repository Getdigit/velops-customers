# VelOps customer AI proxy (Azure Function `velops-customer-ai`)

A **stateless** HTTP-triggered Azure Function that forwards the customer portal's
Claude Messages requests to `https://api.anthropic.com/v1/messages`. It holds the
Anthropic API key server-side and adds the `x-api-key` + `anthropic-version` headers.
It does **no Dataverse work** — every Dataverse action runs in the browser as the
signed-in portal user, with Power Pages table permissions enforcing account scoping
(see [docs/SECURITY.md](../docs/SECURITY.md)).

This is a **separate Function App** from the internal hub's `velops-ai-proxy`:
own resource group, own function key, own CORS origin, own spend caps. The code is a
copy of that proven proxy, adapted for the customer context.

```
Browser (VelOps Support portal SPA, Power Pages code site)
  │  POST { model, max_tokens, system, tools, messages, stream }  + ?code=<function key>
  ▼
Azure Function velops-customer-ai ── adds x-api-key + anthropic-version ──▶ api.anthropic.com
  ▲  streams SSE straight back (enableHttpStream)
```

**Call path — plain browser `fetch`, no custom connector.** Unlike the internal hub
(a Power Apps *code app*, whose CSP blocks all browser fetch), a Power Pages code site
can call out directly. The SPA reads `VITE_AI_PROXY_URL` + `VITE_AI_PROXY_KEY` at build
time (set by the deploy-portal workflow from repo var `AI_PROXY_URL` and secret
`AI_PROXY_FUNCTION_KEY`) and fetches this Function directly.

> The function key therefore ships in the public JS bundle. That is a **deliberate,
> documented v1 trade-off**: the key is a dedicated, revocable spend-control — never a
> data credential. Caps, alerting and the Easy Auth hardening path are in
> [docs/SECURITY.md](../docs/SECURITY.md).

## What's here

| File | Purpose |
|---|---|
| `src/functions/messages.js` | The HTTP trigger: CORS, forward, SSE pass-through. `authLevel: 'function'`. |
| `deploy.ps1` | One-shot resource creation + publish (see below). |
| `host.json` | Functions host config (extension bundle v4). |
| `package.json` | `@azure/functions` v4; Node 20+. |
| `local.settings.json.example` | Template for local dev settings (copy → `local.settings.json`). |

## Run locally

```bash
cd ai-proxy
npm install
cp local.settings.json.example local.settings.json
# edit local.settings.json → set ANTHROPIC_API_KEY (local only; gitignored)
npm start        # → http://localhost:7071/api/messages
```

Smoke test (non-streaming):

```bash
curl -s http://localhost:7071/api/messages -H "content-type: application/json" -d '{
  "model":"claude-sonnet-4-6","max_tokens":64,"stream":false,
  "messages":[{"role":"user","content":"Reply with the single word: ok"}]
}'
```

## Deploy (`deploy.ps1`) — RUNBOOK stap ⑤

Run once after `az login` to the correct (VelOps/getdigit) subscription. Pass the real
portal origin from RUNBOOK stap ④:

```powershell
cd ai-proxy
./deploy.ps1 -AllowedOrigins https://<your-site>.powerappsportals.com
```

Parameters (all optional, shown with defaults):

| Parameter | Default | Meaning |
|---|---|---|
| `-FunctionApp` | `velops-customer-ai` | Function App name |
| `-ResourceGroup` | `velops-customer-ai-rg` | Resource group (created if missing) |
| `-Location` | `westeurope` | Azure region |
| `-StorageAccount` | auto-generated | Storage account name (3–24 chars, lowercase+digits) |
| `-AllowedOrigins` | `https://velops-support.powerappsportals.com` | Comma-separated origins → `ALLOWED_ORIGINS` app setting |
| `-SubscriptionId` | current | Subscription to deploy into |

The script creates the resource group, storage account and Function App (Node 20,
Functions v4, consumption plan), sets `ALLOWED_ORIGINS`, and publishes the code. It
deliberately does **not** set the Anthropic key or Easy Auth — those are manual:

```bash
az functionapp config appsettings set -n velops-customer-ai -g velops-customer-ai-rg \
  --settings ANTHROPIC_API_KEY="<your-anthropic-key>"   # or a Key Vault reference
```

## CORS = portal origin

`ALLOWED_ORIGINS` must be (exactly) the activated portal origin, e.g.
`https://velops-support.powerappsportals.com` — no trailing slash. An origin on the
list gets a credentialed CORS response; any other origin gets a non-credentialed
reflection (safe: access control is the function key, not CORS). Update later with:

```bash
az functionapp config appsettings set -n velops-customer-ai -g velops-customer-ai-rg \
  --settings ALLOWED_ORIGINS="https://<your-site>.powerappsportals.com"
```

If you ever front the site with a custom domain, add that origin too (comma-separated).

## Function key — create a dedicated one, rotate it cheaply

Never use the `default` key in the portal bundle; mint a named key so it can be revoked
without breaking anything else:

```bash
# create (value is auto-generated and printed)
az functionapp function keys set -g velops-customer-ai-rg -n velops-customer-ai \
  --function-name messages --key-name portal

# list / read back
az functionapp function keys list -g velops-customer-ai-rg -n velops-customer-ai \
  --function-name messages
```

Wire-up: repo **variable** `AI_PROXY_URL` = `https://velops-customer-ai.azurewebsites.net/api/messages`,
repo **secret** `AI_PROXY_FUNCTION_KEY` = the `portal` key → re-run the **deploy-portal**
workflow so Vite inlines both into the bundle.

**Rotation** (on leak/abuse, or periodically): run the `keys set` command again (new value),
update the `AI_PROXY_FUNCTION_KEY` secret, re-run deploy-portal. The old bundle stops
working immediately — that is the point.

## Security

The full picture — why the key in the bundle is acceptable for v1, the Sonnet/max_tokens/
turn caps, spend alerting, and the Easy Auth hardening path (`authLevel: 'anonymous'`
behind App Service Authentication, no key in the bundle at all) — lives in
[docs/SECURITY.md](../docs/SECURITY.md). Summary: this key can spend money on Claude
traffic; it can never touch customer data.

## Streaming

The Function enables HTTP streaming (`app.setup({ enableHttpStream: true })`) and pipes
Anthropic's `text/event-stream` straight back, so assistant text streams into the portal
chat as it is generated. Non-streaming requests (or Anthropic errors) are forwarded as
JSON verbatim.
