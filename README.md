# VelOps Customer Support Portal

Klantportaal voor VelOps-teams (wielerploegen): klanten loggen tickets, converseren met het
VelOps-team (met foto's en bestanden) en volgen de status; het VelOps-team werkt de tickets af
in een model-driven app ("VelOps Support Hub"). Alles deployt naar de Power Platform-omgeving
**VelOps Customer** in één unmanaged solution **`VelopsCustomers`** (publisher `getdigit`,
prefix `gd_`, option-value-prefix `12269`). Portaal-UI in het Engels; de goedgekeurde mockup
(`docs/reference/velops-support-portal-mockup.html`) is de 1:1-referentie.

De bindende master-spec is **[docs/PROMPT.md](docs/PROMPT.md)** — afwijkingen worden expliciet
gedocumenteerd.

## Architectuur in 6 regels

1. **`solution/VelopsCustomers/`** — hand-geauthorde unpacked Dataverse-solution: 6 `gd_`-tabellen
   (ticket/message/internalnote/attachment/app/accountapp), 4 global option sets, role, app module + sitemap.
2. **MDA "VelOps Support Hub"** — werkomgeving voor het VelOps-team; ticket-mainform met
   chat-conversatiepaneel (webresource `gd_ticketconversation`) incl. interne notities.
3. **`portal/`** — Power Pages **code site** "VelOps Support": React 19 + Vite SPA, praat rechtstreeks
   met de portal Web API (`/_api`), account-scoped door table permissions.
4. **`ai-proxy/`** — aparte Azure Function App `velops-customer-ai`: stateless pass-through naar de
   Anthropic API voor de AI-intake-assistent (key server-side).
5. **`scripts/`** — zero-dependency Node-scripts met SPN-token: autonumber, app-seed, portalconfig
   (mspp_*-rijen) en `verify.mjs` (read-back assertions, faalt de CI-run bij afwijking).
6. **`.github/workflows/`** — alle Dataverse/deploy-acties lopen via GitHub Actions
   (`microsoft/powerplatform-actions` + pac CLI + SPN-secrets); lokaal draait er niets tegen Dataverse.

## Mappenkaart

```
velops-customers/
├─ README.md                      # dit bestand
├─ docs/
│  ├─ PROMPT.md                   # master-spec (bindend)
│  ├─ RUNBOOK.md                  # eenmalige handmatige stappen ①–⑥ + smoke-checklists
│  ├─ SECURITY.md                 # security-model, AI-key-realiteit, wat verify.mjs afdwingt
│  ├─ BRANDING-AUTH.md            # wat wél/niet brandbaar is aan de platform-loginpagina's
│  └─ reference/                  # goedgekeurde HTML-mockup
├─ solution/VelopsCustomers/      # unpacked solution (Other/, Entities/, OptionSets/,
│                                 #   AppModules/, AppModuleSiteMaps/, Roles/, WebResources/)
├─ formscripts/                   # TypeScript → esbuild → solution/VelopsCustomers/WebResources/
├─ portal/                        # code site SPA (Vite + React 19 + TS, powerpages.config.json)
├─ ai-proxy/                      # Azure Function velops-customer-ai (+ deploy.ps1)
├─ scripts/                       # lib/dataverse.mjs, ensure-autonumber.mjs, seed-apps.mjs,
│                                 #   configure-portal.mjs, verify.mjs
└─ .github/workflows/             # deploy-solution / deploy-portal / configure-portal / export-solution
```

## Deployen — de 4 workflows in volgorde

Alle workflows zijn `workflow_dispatch` (GitHub → Actions → workflow → Run workflow).
Voorwaarde: de eenmalige stappen ①–③ uit [docs/RUNBOOK.md](docs/RUNBOOK.md) zijn gedaan
(repo-variabele `DATAVERSE_URL` + de drie `POWERPLATFORM_*`-secrets).

| # | Workflow | Doet | Let op |
|---|---|---|---|
| 1 | **deploy-solution** | formscripts-build → pack → import `VelopsCustomers` → autonumber → app-seed → verify (schema + data incl. smoke-ticket) | Herhaalbaar; draai na elke solution-wijziging. |
| 2 | **deploy-portal** | SPA-build (met `AI_PROXY_URL`/key indien gezet) → `pac pages upload-code-site` | **Eerste run maakt een INACTIEVE site** → eenmalig activeren (RUNBOOK ④). |
| 3 | **configure-portal** | table permissions + site settings (mspp_*) → verify portal (incl. D1-negatieve asserts) | Vereist een geactiveerde site; faalt anders luid. |
| 4 | **export-solution** | live solution exporteren → unpack → git-diff als drift-rapport + artifact | Alleen-lezen check; pusht niets. |

Volledige volgorde bij een verse omgeving: `deploy-solution` → `deploy-portal` → site activeren (④)
→ `configure-portal`. Daarna hoeft `deploy-portal` **niet** opnieuw — behalve één keer nadat stap ⑤
(AI-proxy) `AI_PROXY_URL` + `AI_PROXY_FUNCTION_KEY` heeft gezet, zodat de bundle die meeneemt.

## Verdere documentatie

- [docs/PROMPT.md](docs/PROMPT.md) — de master-spec (bindend, incl. schema en beslissingen D1/D2)
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — eenmalige handmatige stappen + E2E-smoketest + MDA-checklist
- [docs/SECURITY.md](docs/SECURITY.md) — security-model, AI-key-realiteit, verify-afdwinging
- [docs/BRANDING-AUTH.md](docs/BRANDING-AUTH.md) — branding-grenzen van login/registratie op Power Pages
- [ai-proxy/README.md](ai-proxy/README.md) — de customer-AI Function App (deploy, CORS, key-rotatie)
