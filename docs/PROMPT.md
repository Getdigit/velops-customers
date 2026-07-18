# VelOps Customer Support Portal — master-spec (bouwplan)

> Dit document is de goedgekeurde master-spec voor deze repo. Alles wat hier staat is
> bindend voor de implementatie; afwijkingen worden expliciet gedocumenteerd in de PR/commit.

## Context

De HTML-mockup (`design/customer-portal/velops-support-portal-mockup.html` in `Getdigit/VelopsTemplate`,
branch `claude/velops-customer-portal-os2fzd`; kopie in `docs/reference/`) is goedgekeurd. Nu bouwen we het
echte product: klanten (wielerteams) loggen tickets, converseren met het VelOps-team (met foto's/bestanden),
zien de status; het VelOps-team werkt in een model-driven app. Alles landt in de repo
`Getdigit/velops-customers` (branch `main`) en wordt gedeployed naar de omgeving **"VelOps Customer"**
(env id `1065c3ff-8883-ec09-8198-c3109344fa5e`) in een aparte solution **`VelopsCustomers`**
(publisher `getdigit`, prefix `gd`, optionvalue-prefix `12269`). Portaal-UI in het Engels.

**Beslissingen (bevestigd door Niels):** open registratie + team-koppeling (pending-scherm) · aparte nieuwe
Azure Function App voor AI-intake · deploy via GitHub Actions + service principal · moderne MDA-forms naar
eigen inzicht mét chat-conversatiepaneel · geen "assigned to" · security op account-niveau (teamleden
zien/bewerken elkaars tickets) · app-keuze = tabel + per-team koppeling.

**Kernfeiten uit verkenning:**
- Sessie-containers hebben geen pac/.NET/credentials → alle Dataverse/deploy-acties via CI-runs
  (GitHub Actions, `microsoft/powerplatform-actions`, SPN-secrets), getriggerd en bewaakt via GitHub MCP.
- `pac pages upload-code-site` maakt de code site zelf aan bij eerste upload (verschijnt onder
  "Inactive sites" → eenmalig activeren). Geen Liquid/SSR; login/register zijn platform-hosted
  (`/Account/Login`, `/Account/Login/Register`); user context via `window["Microsoft"].Dynamic365.Portal.User`;
  CSRF via `shell.getTokenDeferred()` / `/_layout/tokenhtml`; file-kolom upload via portal Web API
  (PUT octet-stream, ≤16MB single, 4MB-chunks daarboven).
- Power Pages enhanced data model = `mspp_*` gewone Dataverse-rijen → web role-koppeling, table permissions
  en site settings zijn scriptbaar met SPN-token in CI.
- **Beslissende ontwerpkeuze D1**: table permissions kunnen NIET op kolomwaarde filteren → interne notities =
  aparte tabel `gd_internalnote` zonder enige portal-permission/site setting (hard onzichtbaar). Interne
  bijlagen = annotations op die tabel; publieke bijlagen = `gd_ticketattachment` (file-kolom).
- **D2**: solution wordt hand-geauthored als unpacked XML (Veloops-patronen byte-voor-byte kopieerbaar),
  minimal-first geïmporteerd, daarna iteratief verfijnd. Autonumber (`VEL-{SEQNUM:5}`) bestaat nergens in
  Veloops → belt-and-braces via post-import metadata-API-script.

## Repo-layout

```
velops-customers/
├─ README.md
├─ docs/{PROMPT.md (deze spec), RUNBOOK.md (manuele stappen+checklists), SECURITY.md, BRANDING-AUTH.md}
├─ solution/VelopsCustomers/        # unpacked solution
│  ├─ Other/{Solution.xml, Customizations.xml, Relationships.xml, Relationships/}
│  ├─ Entities/{Account, Contact, gd_App, gd_AccountApp, gd_SupportTicket,
│  │            gd_SupportMessage, gd_InternalNote, gd_TicketAttachment}/
│  ├─ OptionSets/{gd_tickettype, gd_ticketpriority, gd_ticketsource, gd_messagedirection}.xml
│  ├─ AppModules/gd_VelopsSupportHub/ + AppModuleSiteMaps/gd_VelopsSupportHub/
│  ├─ Roles/VelOps Support.xml
│  └─ WebResources/                 # gd_ticketconversation(+.data.xml), gd_ticket_form(+.data.xml)
├─ formscripts/                     # esbuild-pipeline → solution WebResources
├─ portal/                          # Power Pages code site: React 19 + Vite + TS, powerpages.config.json
├─ ai-proxy/                        # Azure Function (kopie velops-ai-proxy) — NIEUWE app "velops-customer-ai"
├─ scripts/                         # Node+SPN-token: lib/dataverse.mjs, ensure-autonumber.mjs, seed-apps.mjs,
│                                   #   configure-portal.mjs, verify.mjs (read-back assertions in CI-log)
└─ .github/workflows/{deploy-solution.yml, deploy-portal.yml, configure-portal.yml, export-solution.yml}
```

## Dataverse-schema (alle option values in 12269xxxx-blok)

**Global option sets:** `gd_tickettype` (122690000 Question / 122690001 Complaint / 122690002 Bug /
122690003 Feature request) · `gd_ticketpriority` (122690000 Low / 122690001 Medium / 122690002 High /
122690003 Critical) · `gd_ticketsource` (122690000 Portal form / 122690001 AI assistant) ·
`gd_messagedirection` (122690000 Customer / 122690001 VelOps).

**`gd_supportticket`** (user-owned): `gd_ticketnumber` autonumber `VEL-{SEQNUM:5}` · `gd_name` = subject
(primary) · `gd_description` memo (de user story) · `gd_tickettype`, `gd_priority` · lookups `gd_account`
(team, **scope-anker**), `gd_contact` (indiener), `gd_app` · `gd_source` · `gd_resolutionsummary` memo ·
`gd_satisfactionrating` int 1–5 · **géén assignee**.
Status: statecode 0 Active → 1 New (default) · 122690001 In Review · 122690002 In Progress ·
122690003 In Development · 122690004 Waiting on Customer · 122690005 Resolved; statecode 1 Inactive →
2 Closed. Portaal-overgangen: klant-reply bij Waiting/Resolved → In Progress; "Yes, close" bij Resolved →
Closed; reopen bij Closed → In Progress. (Authoring-sjabloon: `Veloops/Entities/gd_Races/Entity.xml`
regels 2284–2402.)

**`gd_supportmessage`** (publieke thread): `gd_ticket` lookup (req) · `gd_body` memo · `gd_direction` ·
`gd_authorname` · `gd_authorcontact` lookup optioneel. Géén isinternal-vlag (zie D1).
**`gd_internalnote`** (nooit portal-exposed): `gd_ticket` lookup · `gd_body` · `gd_authorname` ·
HasNotes=true (bijlagen via annotations).
**`gd_ticketattachment`**: `gd_name` (bestandsnaam) · `gd_ticket` lookup (req) · `gd_message` lookup
optioneel · `gd_file` File-kolom (32MB) · `gd_mimetype` · `gd_isimage` bit. Bewust géén lookup naar
internalnote.
**`gd_app`**: naam/omschrijving; seeded: Rider App, Team Hub, Mechanic Hub, Truck App, Fleet,
Planning & Calendar, Travel & Logistics, Reports & Data, Account & Licensing, Other.
**`gd_accountapp`** (junction team↔app): `gd_account` + `gd_app` lookups; portaal-dropdown =
`/_api/gd_accountapps?$filter=_gd_account_value eq <team>&$expand=gd_app`.
**OOB**: Account + Contact als RootComponents (minimale kopieën uit Veloops) + Contact-view
"Unlinked portal signups" (`parentcustomerid` null).
Niet in v1: `gd_aiconversation`-logtabel (AI-sessies in localStorage; ticket draagt de gedistilleerde story).

## Model-driven app "VelOps Support Hub" (`gd_VelopsSupportHub`)

- Sitemap (Fluent VectorIcons): Area **Support** → Tickets (Inbox) · Customers (Teams=Account, Contacts) ·
  Setup (VelOps Apps, Team Apps).
- Ticket-views: New / In Review / In Progress & In Development / Waiting on Customer / Resolved /
  All Active (default) / Closed — kolommen ticketnumber, subject, status, priority, app, account, modifiedon.
- **Ticket-mainform**: header status+priority+account; tab **Conversation** (default) = full-width
  HTML-webresource `gd_ticketconversation`: chat-stijl thread die `gd_supportmessage` + `gd_internalnote`
  merged (klant links / VelOps rechts / interne notes amber-dashed, mockup-CSS), composer met
  **Internal note-toggle**, bijlage-knop (file picker → `gd_ticketattachment`+file-upload of annotation bij
  interne note), inline foto-previews, alles via `Xrm.WebApi`; bij staff-reply op status New → prompt naar
  In Review. Tab **Details**: subject/type/priority/app/source/contact/description + Resolution-sectie.
  Bijlagen-subgrid met `Microsoft.PowerApps.PowerAppsOneGrid`; booleans via
  `MscrmControls.FieldControls.ToggleControl`.
- Form-script `gd_ticket_form` (TS): resolutionsummary verplicht bij Resolved; notificatie bij
  Waiting on Customer. Quick-create-forms voor message/internalnote/accountapp.
- Role "VelOps Support": org-level CRUD op de 6 custom tabellen, read/write account+contact.

## Portaal-SPA (Power Pages code site)

Stack: Vite + React 19 + TS + react-router; geen UI-deps; `index.css` = volledige `--vel-*` v2 tokens +
mockup-component-CSS 1:1; Saira-fonts self-hosted; Engels.

| Route | Inhoud |
|---|---|
| `/` (publiek) | Gebrande landing: logo, hero, **Sign in** → `/Account/Login?ReturnUrl=%2Ftickets`, **Create an account** → `/Account/Login/Register`, "how it works"; ingelogd → redirect `/tickets`. |
| `/tickets` | Lijst per mockup: chips All/Open/Waiting on you/Resolved & closed (+counts), zoek, pills, unread-dot (localStorage lastSeen). |
| `/tickets/new` | Mockup-formulier; Product area = team-apps uit `gd_accountapp`; multi-file drag+drop; submit → ticket (New, source Portal form) + eerste message + attachments → detail + toast met VEL-nummer. |
| `/tickets/:id` | Pills, subject, 4-staps tracker, banners (waiting/resolved met close+reopen+sterren/closed), thread met inline foto's + bestands-chips, composer met bijlagen; statusovergangen zoals hierboven. |
| `/assistant` | AI-intake-chat; knoppen op /tickets en /tickets/new ("Not sure? Ask our assistant"). |
| `/profile` | Profiel bewerken (contact self-scope), teamkaart (naam, apps, teamleden), sign-out. |
| Pending-gate | `parentcustomerid` null → "Your account is awaiting activation…" (blokkeert data-routes). |

API-client: dunne OData-wrapper op `/_api`; mutaties met `__RequestVerificationToken`; `uploadFile()` met
≤16MB single PUT / 4MB-chunks daarboven. Dev-mode: `MockProvider` (mockup-dataset) voor localhost,
`PortalProvider` in builds. `docs/BRANDING-AUTH.md` documenteert wat wél/niet brandbaar is aan de
platform-loginpagina's (gedrag via site settings; styling niet — de merk-momenten zijn landing + in-SPA).

## AI-intake-assistent

- **Aparte nieuwe Azure Function App** (`velops-customer-ai`): code = kopie van `velops-ai-proxy`
  (stateless pass-through naar Anthropic Messages API, key server-side, CORS via `ALLOWED_ORIGINS` =
  portaal-origin, eigen function key). Deploy: `ai-proxy/deploy.ps1` door Niels (eenmalig) óf GH-workflow
  als hij Azure-credentials als secret toevoegt — beide gedocumenteerd in RUNBOOK.
- Client: kopie van hub-patroon (`useAiAgent.ts` tool-loop max 6 iteraties, **write-tools achter
  confirm-card**, `systemPrompt.ts` met cache_control, `sessions.ts` localStorage). Direct `fetch` vanuit
  de SPA (geen code-app CSP). Model: `claude-sonnet-4-6` default (config-vlag voor opus), max_tokens 8000,
  ~30 beurten/sessie cap.
- Systeemprompt (consultant-persona, EN): begrijp vóór je handelt, één gerichte vraag per keer (welke app,
  wat gebeurde vs verwacht, repro, wie geraakt, urgentie t.o.v. race operations); beslisregel: vraag
  volledig beantwoord → tool `no_ticket_needed` (groene kaart "Question answered — no ticket needed");
  anders genoeg info → tool `create_ticket` met expliciete melding "I'm creating the ticket for you".
  Description-contract = klaar-voor-Claude-Code user story: **User story** (As a/I want/So that) +
  **Steps to reproduce** + **Expected/Actual** + **Acceptance criteria** (checkboxes) + **Context**
  (app, geraakte gebruikers, urgentie).
- Tools: `get_team_apps` · `search_my_tickets` (dedupe: "you already reported this") · `create_ticket`
  (confirm-gated; source=AI assistant; eerste message = het verhaal van de klant zelf; deep-link naar
  `/tickets/:id`) · `no_ticket_needed`. Alle reads/writes lopen client-side via portal Web API als de
  ingelogde gebruiker → account-scoping door het platform afgedwongen.
- SECURITY.md: function key zit in publieke bundle → aparte revocable key, sonnet+caps, rate-alerting,
  assistent alleen voor gelinkte gebruikers; hardening-pad (Easy Auth) gedocumenteerd.

## Security & portaalconfig (`scripts/configure-portal.mjs`, idempotent, faalt luid als site niet geactiveerd)

Web role: built-in **Authenticated Users** (geen per-user toewijzing nodig; toegang komt uit
account-scoping — ongelinkte contact ziet 0 rijen → pending-gate). Table permissions: Ticket account-scope
(R/W/C/Append/AppendTo) · Message parent-scope via ticket (R/C/Append) · Attachment parent-scope
(R/W/C/Append — W voor file-PUT) · AccountApp account-scope (R) · App global (R) · Contact self (R/W) ·
Account (R, alleen `name`-veld). **Nergens Delete; géén permission voor gd_internalnote of annotation**
(negatieve assert in verify.mjs). Site settings: `Webapi/<t>/enabled+fields` voor de 6 portaal-tabellen,
registratie open (`Authentication/Registration/Enabled` + `OpenRegistrationEnabled`). Koppel-flow:
registratie → contact zonder account → MDA-view "Unlinked portal signups" → Niels zet `parentcustomerid` →
klant is binnen. Bekende v1-noot: klant kan `gd_direction=VelOps` spoofen binnen eigen team (cosmetisch) —
later plugin.

## CI/CD + eenmalige handmatige stappen

Workflows (alle `workflow_dispatch`, windows-latest): **deploy-solution** (formscripts-build →
pack-solution → import-solution SPN → ensure-autonumber → seed-apps → verify) · **deploy-portal**
(portal build met `VITE_AI_PROXY_URL`+key → actions-install → `pac auth create` SPN →
`pac pages upload-code-site --siteName "VelOps Support"`) · **configure-portal** (mspp-config + verify) ·
**export-solution** (drift-check).

**Handmatig door Niels (RUNBOOK.md):** ① env-URL van `1065c3ff-…` opzoeken → repo-var `DATAVERSE_URL`;
② SPN app-user (System Administrator) in de nieuwe env; ③ secrets `POWERPLATFORM_CLIENT_ID/SECRET/TENANT_ID`
+ `AI_PROXY_FUNCTION_KEY` in de repo; ④ na eerste portal-deploy: site activeren (Power Pages home →
Inactive sites); ⑤ nieuwe Function App deployen (`deploy.ps1`) + `ANTHROPIC_API_KEY` + portaal-origin in
CORS; ⑥ smoke-test volgens checklist.

## Uitvoeringsvolgorde (elke fase verifieerbaar)

1. **Scaffold** repo (layout, docs incl. PROMPT.md, workflows) → push; Niels doet stappen ①–③.
2. **Minimale solution** → `deploy-solution` run groen; verify.mjs: 6 gd_-tabellen, statuscodes,
   autonumber, 10 gd_app-rijen; smoke-ticket via Web API krijgt `VEL-01001`.
3. **MDA-iteratie**: verfijnde forms + conversatie-webresource + views + sitemap + appmodule → re-import;
   verify asserts appmodule/forms/views; visuele check door Niels.
4. **Portaal-SPA** tegen MockProvider (alle routes, CSS-port, upload-util, unit-tests) → build groen in CI.
5. **Portal-deploy** → site activeren (④) → `configure-portal` run; verify: mspp-rijen + negatieve
   internalnote-assert.
6. **E2E-smoke**: demo-account/contact/apps seeden; checklist (register → pending → link → ticket+foto →
   MDA-reply+interne note → onzichtbaarheid checken → resolve → rate → close/reopen).
7. **AI-assistent**: Function App live (⑤), `ai/`-module + tools + prompt, portal her-deploy; smoke.
8. **Hardening/afwerking**: innererror uit, docs als-gebouwd, backlog (notificatie-flows, invitations,
   server-side unread, direction-plugin).

## Belangrijkste risico's

1. Hand-geauthorde solution-XML faalt bij import → minimal-first, alle fragmenten uit werkende
   Veloops-bestanden, importlog in CI, kleine diffs.
2. Autonumber pakt niet via Entity.xml → post-import metadata-API-script + assert + smoke-ticket.
3. Code-site bootstrap op maagdelijke env → strikte volgorde upload → activatie → config; fallback: blanco
   enhanced-site eerst aanmaken en met `--siteName` matchen.
4. AI-function-key in publieke bundle → aparte key, caps, alerting, gating; Easy Auth-pad gedocumenteerd.
5. Registratie/koppel-frictie → pending-gate verbergt alles, koppelen = 10 seconden via speciale view.

## Kritieke referentiebestanden (in `Getdigit/VelopsTemplate`)

- `design/customer-portal/velops-support-portal-mockup.html` (branch `claude/velops-customer-portal-os2fzd`)
  — schermen/statussen/CSS/copy 1:1 naar SPA
- `Veloops/Entities/gd_Races/Entity.xml` (r. 2284–2402) — statecode/statuscode-authoring
- `Veloops/Entities/gd_Hospitality/Entity.xml` + `gd_HospitalityBooking/Entity.xml` — bewezen
  hand-geauthorde entity-patronen (incl. lookups, choices, autonumber primary)
- `Veloops/Other/Solution.xml` — publisher-blok + RootComponents-patroon
- `velops-hub-codeapp/src/ai/useAiAgent.ts` (+ client/systemPrompt/schema/sessions) —
  confirm-before-write agent-loop
- `.github/workflows/deploy-solution.yml` + `velops-formscripts/build.mjs` — CI- en formscript-pipelines
- `velops-ai-proxy/` — Function-code + deploy.ps1 voor de nieuwe customer-AI-app
