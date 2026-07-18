# VelOps AI proxy (Azure Function)

A **stateless** HTTP-triggered Azure Function that forwards the VelOps Hub code app's
Claude Messages requests to `https://api.anthropic.com/v1/messages`. It holds the
Anthropic API key server-side and adds the `x-api-key` + `anthropic-version` headers.
It does **no Dataverse work** — every Dataverse action runs in the browser with the
signed-in user's own permissions.

> ⚠️ **How the code app reaches this Function: a Power Platform CUSTOM CONNECTOR, not a
> browser `fetch`.** Power Apps code apps run under a strict CSP (`connect-src 'none'`)
> that blocks all browser fetch/XHR, so the app calls the Function through the
> **"VelOps AI Proxy"** custom connector (definition in `connector/`), which the Power
> Apps host invokes server-side. The connector injects the Function key as the `?code=`
> query parameter via a `setqueryparameter` policy. The Anthropic key stays here on the
> Function. There is **no `AI_PROXY_URL` in the code app anymore** — the generated
> `VelOpsAIProxyService` is the call path. CORS/Easy-Auth below matter only if you ever
> call the Function directly from a browser (the connector path doesn't).

```
Browser (VelOps Hub code app)
  │  POST { model, max_tokens, system, tools, messages, thinking, stream }
  ▼
Azure Function  (this) ── adds x-api-key + anthropic-version ──▶ api.anthropic.com
  ▲  streams SSE back
  │
Easy Auth (Entra ID) gates the call so only signed-in team members reach it.
```

> ⚠️ **The Anthropic API key is yours to set — this repo never contains it.** Put it
> in the Function App's settings (or a Key Vault reference) yourself. Never paste it
> into the browser code app: anything in `dist/` is extractable.

## What's here

| File | Purpose |
|---|---|
| `src/functions/messages.js` | The HTTP trigger: CORS, forward, SSE pass-through. |
| `host.json` | Functions host config (extension bundle v4). |
| `package.json` | `@azure/functions` v4; Node 20+. |
| `local.settings.json.example` | Template for local dev settings (copy → `local.settings.json`). |

## Prerequisites

- Node.js 20+
- [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local) (`func`)
- Azure CLI (`az`) logged in to the target subscription
- An Anthropic API key

## Run locally

```bash
cd velops-ai-proxy
npm install
cp local.settings.json.example local.settings.json
# edit local.settings.json → set ANTHROPIC_API_KEY (local only; gitignored)
npm start        # → http://localhost:7071/api/messages
```

Smoke test (non-streaming):

```bash
curl -s http://localhost:7071/api/messages -H "content-type: application/json" -d '{
  "model":"claude-opus-4-8","max_tokens":64,"stream":false,
  "messages":[{"role":"user","content":"Reply with the single word: ok"}]
}'
```

## Deploy to Azure

```bash
# 1) Resources (adjust names/region)
az group create -n velops-ai-rg -l westeurope
az storage account create -n velopsaistore$RANDOM -g velops-ai-rg -l westeurope --sku Standard_LRS
az functionapp create -n velops-ai-proxy -g velops-ai-rg \
  --storage-account <storageName> --consumption-plan-location westeurope \
  --runtime node --runtime-version 20 --functions-version 4

# 2) The API key — App Setting (or Key Vault reference, see below)
az functionapp config appsettings set -n velops-ai-proxy -g velops-ai-rg \
  --settings ANTHROPIC_API_KEY="<your-anthropic-key>" \
             ALLOWED_ORIGINS="https://apps.powerapps.com"

# 3) Publish
func azure functionapp publish velops-ai-proxy
```

The publish step prints the function URL, e.g.
`https://velops-ai-proxy.azurewebsites.net/api/messages`.

### Key Vault instead of a plain App Setting (recommended)

```bash
az keyvault create -n velops-ai-kv -g velops-ai-rg -l westeurope
az keyvault secret set --vault-name velops-ai-kv -n anthropic-key --value "<your-anthropic-key>"
az functionapp identity assign -n velops-ai-proxy -g velops-ai-rg
# grant the Function's managed identity 'get' on secrets, then:
az functionapp config appsettings set -n velops-ai-proxy -g velops-ai-rg --settings \
  ANTHROPIC_API_KEY="@Microsoft.KeyVault(SecretUri=https://velops-ai-kv.vault.azure.net/secrets/anthropic-key/)"
```

### Lock it down — Easy Auth (Entra ID)

So only signed-in VelOps team members can call the proxy:

1. Function App → **Settings → Authentication → Add identity provider → Microsoft**.
2. App registration in your tenant; **Restrict access: Require authentication**;
   **Unauthenticated requests: HTTP 401**.
3. Restrict to your tenant (and optionally specific users/groups).

The Function uses `authLevel: 'anonymous'` on purpose — Easy Auth gates the request
*before* the Function runs, so no function key ends up in the browser bundle.

### CORS

The browser sends `credentials: 'include'`, so the response cannot use
`Access-Control-Allow-Origin: *` together with credentials. **`ALLOWED_ORIGINS` is
therefore required** for the browser flow: set it (comma-separated) to your Power Apps
host origin(s), e.g. `https://apps.powerapps.com`. The Function only returns
`Access-Control-Allow-Credentials: true` for an origin that exactly matches the list —
any other case (origin not listed, or `ALLOWED_ORIGINS` unset) returns a
non-credentialed response, so the call is safely blocked by the browser rather than
silently insecure. Also add the same origins under the Function App's **CORS** blade.
(Confirm the exact runtime origin from the browser dev-tools Network tab on first run,
since Power Platform may serve from an app- or tenant-specific host.)

## Wire it to the code app (via the custom connector)

The code app does **not** use a URL — it calls the Function through the **VelOps AI Proxy**
custom connector. Setup (already done for VelOps Template; repeat per environment):

1. Create the connector from `connector/apiDefinition.json` + `connector/apiProperties.json`:
   `pac connector create -df connector/apiDefinition.json -pf connector/apiProperties.json`
2. In the deployed connector's policy (`setqueryparameter`), set the `code` value to this
   environment's Function key (the committed `apiProperties.json` uses
   `@connectionParameters('api_key')`; the live VelOps Template connector hardcodes the key
   in the policy because the connection-parameter form didn't resolve — see the memory note).
3. Create a connection for the connector (maker portal), then add it to the code app:
   `pac code add-data-source --apiId <shared_...> --connectionId <...>` — this regenerates
   `src/generated/VelOpsAIProxyService.ts`, which `src/ai/client.ts` calls.
4. `npm run build` + `pac code push`.

Why a connector and not `fetch`: see the CSP note at the top of this README.

## Streaming

The Function enables HTTP streaming (`app.setup({ enableHttpStream: true })`) and pipes
Anthropic's `text/event-stream` straight back, so the assistant's text streams into the
drawer as it's generated. Non-streaming requests (or Anthropic errors) are forwarded as
JSON verbatim.

## Open decision — which environment

The proxy is environment-agnostic (it only needs the Anthropic key). The **open call** is
where to point the code app first: a throwaway **sandbox** Power Platform env, or straight
at **VelOps Template**. The Veloops solution currently has no flows / env vars / connection
references, so this AI feature is all-new infra either way. Recommendation: prove the loop
in a sandbox build of the hub app, then retarget `power.config.json` to VelOps Template.

## Cost / model

The app requests `claude-opus-4-8` (1M context, $5/$25 per Mtok) for demo quality, with
adaptive thinking and prompt-caching of the static glossary. For routine/cost, switch
`MODEL` to `claude-sonnet-4-6` in `src/ai/config.ts` (no proxy change needed).
