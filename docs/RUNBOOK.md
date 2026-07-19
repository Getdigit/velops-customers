# RUNBOOK — eenmalige handmatige stappen + smoke-checklists

Alles wat CI **niet** kan doen staat hier. Stappen ① t/m ⑥ zijn eenmalig, in deze volgorde.
Daarna is alles herhaalbaar via de workflows (zie [README](../README.md)).

## Stand van zaken (as-built, 19-07-2026)

- ①–④ zijn **uitgevoerd**: env-URL `https://velops-customer.crm4.dynamics.com`, SPN + secrets
  staan, solution geïmporteerd (verify groen incl. smoke-ticket `VEL-01001`), portal geüpload,
  site geactiveerd op **`https://velopssupport.powerappsportals.com`**, configure-portal **groen**
  (7 table permissions gelinkt aan Authenticated Users, 15 site settings, D1-negatief-asserts —
  op beide benoemde site-rijen). NB: de rol-koppeling loopt via de `powerpagecomponent`
  self-N:N; de virtuele `mspp_entitypermission_webrole`-relatie accepteert associates maar
  bewaart ze niet (zie scripts/configure-portal.mjs).
- **Nog te doen: ⑤ (AI-proxy) en ⑥ (smoketest)**, plus de sanering hieronder.
- **Geleerde les 1 — js-blokkade:** Dataverse blokkeert `.js`-bijlagen standaard; daardoor faalde
  elke code-site-upload met `PortalFileContentUploadFailed`. Opgelost door `js` te verwijderen
  uit *Blocked attachments* (admin center → env → Settings → Privacy + Security). **Bij een
  nieuwe omgeving: doe dit vóór de eerste deploy-portal-run.**
- **Security-nazorg:** het SPN-client-secret en een Anthropic-key zijn tijdens de setup door
  een chatsessie gegaan — roteer beide op een rustig moment (nieuw client secret → repo-secret
  `POWERPLATFORM_CLIENT_SECRET` updaten; nieuwe Anthropic-key → alleen in de Function App-settings).
- **Geleerde les 2 — duplicate sites + VERPLICHTE saneringsstap:** elke mislukte
  `upload-code-site`-run maakte een NIEUWE inactieve site aan. De smoke-test van 19-07 toont
  dat de destijds geactiveerde site (site-kgbyt) de **lege shell** van een mislukte upload is:
  hij serveert HTTP 500 en `/_api` geeft 404. **Fix (2 min):** Power Pages home → verwijder de
  actieve kapotte site → activeer één van de twee complete **"VelOps Support"**-kaarten
  (beide bevatten de volledige bundle én de portaalconfig — welke maakt niet uit) → verwijder
  de overgebleven duplicaat-kaart. De site-URL VERANDERT hierdoor; gebruik de nieuwe URL in
  stap ⑤ (`-AllowedOrigins`) en meld hem in de chat zodat de HTTP-smoke-test opnieuw kan
  draaien (`scripts/smoke-portal-http.mjs` via **Run Ops Script**, met env `PORTAL_URL` of
  aangepaste default). Opnieuw configureren is niet nodig.

## ① Environment-URL opzoeken → repo-variabele `DATAVERSE_URL`

- [ ] Ga naar <https://admin.powerplatform.microsoft.com> → **Environments**.
- [ ] Open de omgeving **VelOps Customer** (env id `1065c3ff-8883-ec09-8198-c3109344fa5e` —
      staat in de URL/details als je twijfelt welke het is).
- [ ] Kopieer de **Environment URL** (vorm: `https://<org>.crm4.dynamics.com`).
- [ ] GitHub-repo → **Settings → Secrets and variables → Actions → tab "Variables"** →
      **New repository variable**: naam `DATAVERSE_URL`, waarde = die URL (met of zonder
      trailing slash, de scripts normaliseren).

## ② SPN app-user (System Administrator) in de omgeving

De CI authenticeert als service principal. Hergebruik de bestaande VelOps CI-app-registratie
of maak een nieuwe:

- [ ] <https://portal.azure.com> → **Microsoft Entra ID → App registrations** →
      bestaande registratie openen of **New registration** (naam bv. `velops-customers-ci`,
      single tenant, geen redirect URI).
- [ ] Noteer **Application (client) ID** en **Directory (tenant) ID** (Overview-blad).
- [ ] **Certificates & secrets → New client secret** → waarde meteen kopiëren
      (daarna nooit meer zichtbaar).
- [ ] Terug in <https://admin.powerplatform.microsoft.com> → **Environments → VelOps Customer →
      Settings → Users + permissions → Application users** → **+ New app user** →
      **Add an app** → kies de registratie → Business unit = root →
      **Edit security roles** → **System Administrator** → **Create**.

## ③ Repo-secrets en -variabelen zetten

GitHub-repo → **Settings → Secrets and variables → Actions**:

- [ ] Tab **Secrets** → **New repository secret**, drie stuks uit stap ②:
      `POWERPLATFORM_CLIENT_ID` · `POWERPLATFORM_CLIENT_SECRET` · `POWERPLATFORM_TENANT_ID`.
- [ ] Secret `AI_PROXY_FUNCTION_KEY` — pas invullen ná stap ⑤ (mag zolang leeg/afwezig zijn;
      de portal-build slaagt ook zonder).
- [ ] Tab **Variables**: `DATAVERSE_URL` (stap ①) en later `AI_PROXY_URL` (stap ⑤).

Nu kunnen **deploy-solution** en **deploy-portal** draaien (Actions → workflow → Run workflow).

## ④ Site activeren (na de éérste deploy-portal-run)

`pac pages upload-code-site` maakt de site bij de eerste upload zelf aan — **inactief**.

- [ ] Draai de workflow **deploy-portal** (groen = upload gelukt).
- [ ] Ga naar <https://make.powerpages.microsoft.com> → kies rechtsboven de omgeving
      **VelOps Customer**.
- [ ] Sectie **Inactive sites** → **VelOps Support** → **Activate** (even wachten op provisioning).
- [ ] Noteer de site-URL (`https://<naam>.powerappsportals.com`) — nodig voor CORS in stap ⑤.
- [ ] Draai daarna de workflow **configure-portal** (table permissions + site settings; die
      faalt bewust zolang de site niet actief is).

**Workflow-volgorde totaal:** `deploy-solution` → `deploy-portal` → activeren (deze stap) →
`configure-portal`. `deploy-portal` hoeft hierna **niet** opnieuw — alleen één keer na stap ⑤,
zodat de bundle `AI_PROXY_URL`/key meeneemt.

## ⑤ AI-proxy: Function App `velops-customer-ai` deployen

Volledige details in [ai-proxy/README.md](../ai-proxy/README.md); kort:

- [ ] Lokaal: `az login` (juiste subscription) → `cd ai-proxy` →
      `./deploy.ps1 -AllowedOrigins https://velopssupport.powerappsportals.com`.
- [ ] Zet de Anthropic-key (nooit committen):
      `az functionapp config appsettings set -n velops-customer-ai -g velops-customer-ai-rg --settings ANTHROPIC_API_KEY="<key>"`.
- [ ] Maak een **aparte, roteerbare function key** aan (bv. `portal`) en check CORS —
      zie ai-proxy/README.md, sectie "Function key".
- [ ] Repo-variabele `AI_PROXY_URL` = `https://velops-customer-ai.azurewebsites.net/api/messages`;
      repo-secret `AI_PROXY_FUNCTION_KEY` = de nieuwe key (paden: zie stap ③).
- [ ] Draai **deploy-portal** één keer opnieuw (bundle pikt de AI-config op).

## ⑥ E2E-smoketest (na ①–⑤)

Registratie & koppeling:

- [ ] Portal → **Create an account** → registreer met een testmailadres → na login verschijnt
      het **pending**-scherm ("awaiting activation") en zijn de data-routes geblokkeerd.
- [ ] MDA **VelOps Support Hub** → Contacts → view **"Unlinked portal signups"** → open het
      nieuwe contact → zet **Account** (parentcustomerid) op het demo-team → save.
- [ ] Portal verversen → pending weg → `/tickets` toont de (lege) lijst.

Ticketflow:

- [ ] **New ticket**: onderwerp + omschrijving + Product area (dropdown = team-apps) +
      **foto als bijlage** → submit → toast met `VEL-#####` → detailpagina toont thread + foto inline.
- [ ] MDA: ticket staat in view **New** → open → **Conversation**-tab → reply als VelOps →
      prompt "naar In Review?" accepteren → óók een **interne notitie** plaatsen (toggle).
- [ ] Portal: de reply is zichtbaar, de **interne notitie NIET** — check ook rauw:
      `https://<site>/_api/gd_internalnotes` moet een fout geven (geen permission, spec D1).
- [ ] MDA: status **Resolved** (resolution summary is verplicht — leeg laten moet blokkeren).
- [ ] Portal: resolved-banner → **sterren-rating** geven → **"Yes, close"** → status Closed →
      **Reopen** → status springt naar In Progress.
- [ ] (Na ⑤) Assistant: stel een vraag → groene kaart "no ticket needed"; meld een bug →
      confirm-kaart → ticket met source **AI assistant** + deep-link werkt.

## MDA visuele checklist (fase 3)

- [ ] App **VelOps Support Hub** opent; sitemap-area **Support**: Tickets · Teams · Contacts ·
      VelOps Apps · Team Apps (Fluent-iconen zichtbaar).
- [ ] Ticket-views aanwezig: New / In Review / In Progress & In Development / Waiting on
      Customer / Resolved / **All Active (default)** / Closed — kolommen ticketnumber, subject,
      status, priority, app, team, modified on.
- [ ] Ticket-form: header toont status + priority + team; tab **Conversation** is default en
      full-width; klant links, VelOps rechts, interne notes amber-dashed (mockup-stijl).
- [ ] Composer: internal-note-toggle, bijlage-knop (file → `gd_ticketattachment`, bij interne
      note → annotation), inline foto-previews.
- [ ] Tab **Details**: subject/type/priority/app/source/submitted by/description +
      Resolution-sectie; bijlagen-subgrid vult zich.
- [ ] Quick create werkt voor message / internal note / team app.
