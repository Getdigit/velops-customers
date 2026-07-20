# RUNBOOK — eenmalige handmatige stappen + smoke-checklists

Alles wat CI **niet** kan doen staat hier. Stappen ① t/m ⑥ zijn eenmalig, in deze volgorde.
Daarna is alles herhaalbaar via de workflows (zie [README](../README.md)).

## Stand van zaken (as-built, 19-07-2026)

- ①–④ zijn **uitgevoerd**: env-URL `https://velops-customer.crm4.dynamics.com`, SPN + secrets
  staan, solution geïmporteerd (verify groen incl. smoke-ticket `VEL-01001`), portal geüpload,
  site geactiveerd op **`https://velopssupport.powerappsportals.com`**. De 7 table permissions
  en 15 site settings staan (incl. D1-negatief-asserts, op beide benoemde site-rijen).
- **⚠️ ÉÉN handmatige stap resteert (stap ④c hieronder): de rol-koppeling.** De koppeling
  tabelrecht → webrol leeft in de relatie `mspp_entitypermission_webrole`, en die is **niet
  via de Web API te schrijven** (deep-insert → HTTP 500; `$ref` → 204 maar bewaart 0 rijen —
  bewezen in `scripts/fix-perm-webrole.mjs`). Een eerdere versie schreef naar de
  `powerpagecomponent` self-N:N die "gekoppeld" teruglas maar door de runtime wordt genegeerd
  (vals-groen). Zolang de echte relatie leeg is toont het portaal
  **`EntityPermissionReadIsMissing`** / "You don't have permission to read the contact table"
  en blijft elke ingelogde bezoeker op het pending-scherm. **Fix = eenmalig in de Power Pages
  Security-UI** (stap ④c). `configure-portal` detecteert dit nu en print de exacte stap;
  `verify.mjs` (scope=portal) faalt rood tot de koppeling er echt staat.
- **⑤ is uitgevoerd (20-07):** Function App `velops-customer-ai` staat live (Node 24, eigen
  function key `portal` + CORS op de live-URL, Anthropic-key server-side). De hele keten is
  geverifieerd — `scripts/smoke-ai-proxy.mjs` 5/5 (preflight, echte Messages-call, key-gate)
  en `scripts/verify-bundle-ai.mjs` bevestigt dat de live bundle de proxy-URL ingebakken heeft.
  Deployen gebeurt via de workflow **deploy-ai-proxy**; bundle-updates via
  `scripts/sync-spa-bundle.mjs`.
- **Nog te doen: ④c (rol-koppeling in de Security-UI) en ⑥ (handmatige login-smoketest)**, plus
  de sanering/security-rotatie hieronder.
- **Geleerde les 1 — js-blokkade:** Dataverse blokkeert `.js`-bijlagen standaard; daardoor faalde
  elke code-site-upload met `PortalFileContentUploadFailed`. Opgelost door `js` te verwijderen
  uit *Blocked attachments* (admin center → env → Settings → Privacy + Security). **Bij een
  nieuwe omgeving: doe dit vóór de eerste deploy-portal-run.**
- **Security-nazorg:** het SPN-client-secret en een Anthropic-key zijn tijdens de setup door
  een chatsessie gegaan — roteer beide op een rustig moment (nieuw client secret → repo-secret
  `POWERPLATFORM_CLIENT_SECRET` updaten; nieuwe Anthropic-key → alleen in de Function App-settings).
- **Geleerde les 2 — deploy-portal maakt ALTIJD een nieuwe site aan; gebruik
  sync-spa-bundle:** elke `upload-code-site`-run maakte een NIEUWE inactieve site aan in
  plaats van de bestaande te matchen — vijf keer op rij, óók in een gecontroleerd
  experiment (20:21) met precies één settelde site in de omgeving. **Een nieuwe
  SPA-bundle uitrollen doe je daarom NIET met deploy-portal maar met Run Ops Script →
  `scripts/sync-spa-bundle.mjs`** (bewezen werkend 20-07): bouwt de SPA op de runner
  (met `AI_PROXY_URL`/key uit de repo-config zodra die bestaan, stap ⑤) en zet de bundle
  rechtstreeks op de live site — webfiles upserten, verouderde hash-bundels opruimen,
  Home-contentpagina verversen, met readback-verificatie. Ontstaat er ooit tóch een
  duplicaat-site (bv. door een onbedoelde deploy-portal-run): opruimen met het
  id-gepinde `scripts/delete-portal-sites.mjs`; stand checken met
  `scripts/list-portal-sites.mjs`.
- **Geleerde les 3 — lege "Home" in plaats van de SPA (opgelost 19-07 ~20:00):** pac's
  omgevings-manifest verwees de drie "speciale" records van een code site — de **Home
  content-pagina** (waarvan `mspp_copy` de gecompileerde `index.html` IS), en de
  **Header/Footer-webtemplates** (`<div/>`, om de platform-chrome te onderdrukken) — naar
  component-ids van de allereerste (verwijderde) uploadsite. Elke upload "updatte" die drie
  dus in het luchtledige (`Entity ... Does Not Exist`) en géén site kreeg ze ooit; de live
  site rendert dan de lege standaard-Home. **Fix:** `scripts/repair-code-site.mjs` heeft de
  drie records op de live site (5fece082) aangemaakt met exact de ids waar de site-rij en
  pac's manifest al naar wezen (header `89c87355…`, footer `7c2c45dd…`, Home-content
  `45436da8…`; Dataverse honoreert expliciete primary keys bij create). Structuur
  geverifieerd tegen Microsofts `power-pages-samples` car-sales-website codesite-sample.
  Sindsdien serveert <https://velopssupport.powerappsportals.com> de SPA. NB: een by-id GET
  op een niet-bestaande virtuele mspp-rij geeft HTTP 500 (geen 404) — bestaan checken met
  een `$filter`-query; en PATCH op virtuele rijen wordt geweigerd — updaten = delete +
  re-create op hetzelfde gepinde id (sync-spa-bundle doet dit voor de Home-copy).
- **Geleerde les 4 — kale loginpagina (opgelost 20-07):** twee oorzaken. (1) Onze
  `bundleFilePatterns` (`*.css`) verwijderde bij elke upload ook pac's standaard
  theme-webfiles (`bootstrap.min.css`/`portalbasictheme.css`/`theme.css`) waar de
  platform-loginpagina's op leunen → patronen versmald tot `assets/*` en de drie
  bestanden staan nu in `portal/platform-theme/` (met VelOps-styling in `theme.css`:
  Saira, geel/inkt) en worden op de live site gezet door
  `scripts/apply-platform-theme.mjs` (Run Ops Script, idempotent). (2) De SPA linkte
  naar het legacy-endpoint `/Account/Login`, dat GEEN site-css laadt en altijd kaal
  rendert; het moderne `/SignIn` laadt de theme-webfiles wél. `SIGN_IN_URL` wijst nu
  naar `/SignIn?ReturnUrl=…` — screenshot-geverifieerd: sign-in/registratie in
  VelOps-stijl. De BRANDING-AUTH-notitie "loginpagina is niet te stylen" is hiermee
  achterhaald: styling kan via de theme-webfiles.

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
      faalt bewust zolang de site niet actief is). Aan het eind print de log óf alles gelinkt
      is, óf een **ACTION REQUIRED**-blok met de permissies die nog een rol-koppeling missen —
      dat is stap ④c hieronder.

**Workflow-volgorde totaal:** `deploy-solution` → `deploy-portal` → activeren (deze stap) →
`configure-portal` → **④c rol-koppeling (Security-UI)**. `deploy-portal` hoeft hierna **nooit**
meer (geleerde les 2) — nieuwe bundles (o.a. na stap ⑤) gaan via
**Run Ops Script → `scripts/sync-spa-bundle.mjs`**.

## ④c Rol-koppeling: "Authenticated Users" aan de 7 tabelrechten (eenmalig, VERPLICHT)

**Dit is de één stap die de Web API niet kan en die je dus met de hand doet.** De runtime
leest de koppeling tabelrecht → webrol uitsluitend uit de relatie
`mspp_entitypermission_webrole`, en die is niet via de API te vullen (deep-insert → HTTP 500;
`$ref` → 204 maar 0 rijen bewaard — bewezen in `scripts/fix-perm-webrole.mjs`). Blijft die
relatie leeg, dan geeft het portaal `EntityPermissionReadIsMissing` /
"You don't have permission to read the contact table" en blijft elke ingelogde klant op het
pending-scherm hangen (óók al is zijn contact correct aan een team gekoppeld, óók in incognito,
óók na een site-restart — het is niet de cache maar de ontbrekende koppeling).

- [ ] <https://make.powerpages.microsoft.com> → kies de omgeving **VelOps Customer** → site
      **VelOps Support**.
- [ ] Linker rail: **Security → Table permissions**.
- [ ] Open **elk** van deze 7 rechten, klik **Add roles** (of **Edit** → sectie *Roles*), vink
      **Authenticated Users** aan, **Save**:
  - [ ] **Contact - self** (`contact`)
  - [ ] **Ticket - account scope** (`gd_supportticket`)
  - [ ] **Message - parent via ticket** (`gd_supportmessage`)
  - [ ] **Attachment - parent via ticket** (`gd_ticketattachment`)
  - [ ] **Team apps - account scope** (`gd_accountapp`)
  - [ ] **Apps - global** (`gd_app`)
  - [ ] **Account - own team** (`account`)
- [ ] De wijziging is meteen live (geen site-restart nodig). Herlaad het portaal en de
      pending-melding hoort weg te zijn.
- [ ] Bevestig met **Run Ops Script → `scripts/verify.mjs`** (`VERIFY_SCOPE=portal`): elke
      "table permission … linked to Authenticated Users" hoort **PASS** te zijn. Zolang er nog
      één rood staat, is die permissie nog niet gekoppeld. (De SPN-/anonieme smoke-tests dekken
      dit NIET — de SPN omzeilt portal-permissies.)

## ④b Site visibility op Public zetten (eenmalig, na activatie)

Nieuwe sites staan standaard op **Private**: alle bezoekers (ook anoniem) worden eerst door
Entra-login gestuurd en klanten kunnen er dus niet in. Zichtbaar aan een
"Sign in to your account"-scherm op de site-URL.

- [ ] <https://make.powerpages.microsoft.com> → site **VelOps Support** → **Security** →
      **Site visibility** → **Public** → bevestigen.
- [ ] Check: de site-URL toont daarna de VelOps-landing zonder Microsoft-login;
      `scripts/smoke-portal-http.mjs` (workflow **Run Ops Script**) hoort volledig groen te zijn.

## ⑤ AI-proxy: Function App `velops-customer-ai` deployen

Grotendeels geautomatiseerd via de workflow **deploy-ai-proxy** (details in
[ai-proxy/README.md](../ai-proxy/README.md)); jij zet alleen de credentials/secrets:

- [ ] Eenmalig deployment-credentials maken (Azure CLI, ingelogd op de juiste subscription):
      `az ad sp create-for-rbac --name velops-customer-ai-deploy --role Contributor --scopes /subscriptions/<subscription-id> --sdk-auth`
      → de VOLLEDIGE JSON-output als repo-secret `AZURE_CREDENTIALS`.
- [ ] Repo-secret `ANTHROPIC_API_KEY` = een **nieuwe** Anthropic-key (de eerdere is door
      de chat gegaan — die niet hergebruiken).
- [ ] Actions → **deploy-ai-proxy** → **Run workflow** (de CORS-origin staat standaard op
      de live site-URL). De workflow maakt de resource group, storage, Function App aan,
      publiceert de code, zet ALLOWED_ORIGINS + de Anthropic-key en provisiont een aparte
      function key `portal` (de waarde komt bewust nergens in logs).
- [ ] Azure Portal → **velops-customer-ai → Functions → messages → Function keys** →
      kopieer key `portal` → repo-**secret** `AI_PROXY_FUNCTION_KEY`; en zet
      `AI_PROXY_URL` = `https://velops-customer-ai.azurewebsites.net/api/messages`
      (mag als repo-**variabele** óf repo-**secret** — de workflow accepteert beide).
- [ ] Draai **Run Ops Script** met `scripts/sync-spa-bundle.mjs` (NIET deploy-portal —
      geleerde les 2): dit bouwt de bundle mét de AI-config en zet hem rechtstreeks op
      de live site. Controleer met `scripts/smoke-ai-proxy.mjs` (Run Ops Script) — hoort
      `{"pass":true,"passed":5}` te geven (preflight, echte Messages-call, key-gate).
- NB: bewust géén Easy Auth op deze Function App — portaalbezoekers zijn geen
  tenant-gebruikers; de toegangscontrole is de function key + CORS.

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
