# SECURITY — model, AI-key-realiteit en wat verify.mjs afdwingt

## Security-model van het portaal

Toegang komt volledig uit **Power Pages table permissions** op de built-in web role
**Authenticated Users** — geen per-user toewijzing. Het platform dwingt de scoping
server-side af; de SPA is puur presentatie.

| Permission | Tabel | Scope | Rechten |
|---|---|---|---|
| Ticket - account scope | `gd_supportticket` | Account (via `gd_supportticket_Account_account`) | R/W/C/Append/AppendTo |
| Message - parent via ticket | `gd_supportmessage` | Parent (via ticket) | R/C/Append/AppendTo |
| Attachment - parent via ticket | `gd_ticketattachment` | Parent (via ticket) | R/**W**/C/Append/AppendTo — Write is nodig voor de file-PUT op `gd_file` |
| Team apps - account scope | `gd_accountapp` | Account | R |
| Apps - global | `gd_app` | Global | R |
| Contact - self | `contact` | Self | R/W |
| Account - own team | `account` | Account | R |

> ⚠️ **Belangrijke as-built nuance (20-07-2026): op deze site honoreert de Power Pages-runtime
> het koppelrecht (Append/AppendTo) NIET voor portaalgebruikers.** Lezen werkt; élke
> associatie die een portaalgebruiker op create zet (een lookup binden) faalt met
> `EntityPermissionAppendToIsMissingDuringAssociationChange` — ongeacht scope, verse
> permissie, of cache-clear/restart (uitputtend bewezen). De R/W/C/Append/AppendTo-kolommen
> hierboven gelden dus voor wat de tabelrechten *zouden* moeten toestaan; effectief sturen ze
> op deze site alleen **reads** (en scalar-PATCH: status/rating/profiel). **Het aanmaken van
> tickets/berichten/bijlagen loopt daarom server-side** via de Function (zie hieronder), niet
> via de portal Web API. De account-scoping op reads blijft volledig gelden.

Kernpunten:

- **Account-scoping is het anker.** Teamleden zien en bewerken elkaars tickets (bewuste
  keuze); een ander team ziet nul rijen. Een **ongelinkt contact** (parentcustomerid leeg)
  matcht geen enkele scope → ziet nul rijen → de SPA toont de pending-gate. De koppeling
  (registratie → view "Unlinked portal signups" → account zetten) is daarmee ook de
  autorisatie-handeling.
- **Record-creatie loopt server-side (admin SPN).** `POST /api/portalwrite` (ticket + bericht)
  en `POST /api/portalupload` (bijlage) op de Function App `velops-customer-ai` maken de rijen
  aan met de service-principal, omdat de portal Web API het koppelen weigert (zie de nuance
  hierboven). De **account wordt server-side afgeleid** uit `contact.parentcustomerid` (nooit
  van de client vertrouwd), en berichten/bijlagen worden geweigerd op een ticket buiten het
  eigen team (403). Zo blijft team-scope gehandhaafd. Toegang tot het endpoint is dezelfde
  **function key** als de AI-proxy (semi-publiek in de bundle — zie hieronder). Restrisico
  (v1, hardenbaar): wie een ander contact-GUID kent kan een ticket op naam van dat team
  aanmaken (geen data te *lezen* zo). Fast-follow: een Power Pages-sessietoken in de Function
  valideren i.p.v. de client-`contactId` vertrouwen.
- **D1 — interne notities zijn hard onzichtbaar.** Table permissions kunnen niet op
  kolomwaarde filteren, dus interne notities staan in een aparte tabel `gd_internalnote`
  die NOOIT een table permission of `Webapi/*`-site setting krijgt; interne bijlagen zijn
  annotations op die tabel (ook nooit geëxposed). `configure-portal.mjs` heeft een guard
  die weigert te draaien als iemand ze ooit aan de config toevoegt; `verify.mjs` assert
  het negatief tegen de live omgeving (zie onder).
- **Nergens Delete.** Geen enkele permission geeft Delete (`mspp_delete` staat overal
  expliciet op false); portaalgebruikers kunnen niets verwijderen, ook hun eigen rijen niet.
- **Bekende v1-noot — direction-spoof.** De klant kan via de Web API zelf een
  `gd_supportmessage` met `gd_direction = VelOps` aanmaken. Impact: cosmetisch en alleen
  binnen het eigen team (de account-scope blijft gelden). Fix staat op de backlog: een
  synchrone plugin die `gd_direction` op create afdwingt op basis van de caller.
- **Reads** en scalar-PATCH (status/rating/profiel) vanuit de SPA lopen als de ingelogde
  portalgebruiker en dragen het CSRF-token (`__RequestVerificationToken` via
  `shell.getTokenDeferred()`). **Record-creatie** (ticket/bericht/bijlage) loopt bewust NIET
  als de portalgebruiker maar via de Function met de service-principal — dat is de enige weg
  die op deze site werkt (koppelrecht-nuance hierboven), met de account server-side afgeleid
  en de team-scope server-side afgedwongen.

## AI-key-realiteit (assistent / ai-proxy)

De SPA roept de Function App `velops-customer-ai` rechtstreeks aan met een **function key
die in de publieke JS-bundle zit**. Elke ingelogde portalgebruiker kan die key dus uitlezen.
Consequenties en mitigaties (bewuste v1-afweging):

- **Aparte, roteerbare key.** De portal gebruikt een eigen function key (niet de default),
  los van de interne hub-proxy. Lekt of misbruikt → key intrekken, nieuwe zetten in
  repo-secret `AI_PROXY_FUNCTION_KEY`, deploy-portal opnieuw draaien. Rotatie-commando's:
  [ai-proxy/README.md](../ai-proxy/README.md).
- **Schade-plafond.** Model staat op **Sonnet** (geen Opus), `max_tokens` gecapt (8000),
  tool-loop max 6 iteraties, ~30 beurten per sessie. De key geeft alleen toegang tot
  Claude-verkeer op onze rekening — nooit tot Dataverse (alle data-acties lopen client-side
  als de gebruiker zelf, zie boven).
- **Rate-/spend-alerting.** Zet een budget-alert op de Anthropic-key en een Azure-alert op
  het request-volume van de Function App; de key is een kostenrisico, geen datarisico.
- **Alleen voor gelinkte gebruikers.** De SPA toont de assistent pas voorbij de
  pending-gate; de landing/publieke routes bevatten geen AI-calls.
- **Hardening-pad (fast-follow):** App Service Authentication (Easy Auth, Entra) vóór de
  Function + `authLevel: 'anonymous'`, zodat er geen key meer in de bundle zit; of een
  lichte sessie-check in de Function. Gedocumenteerd in ai-proxy/README.md.
- De **Anthropic-key zelf** staat uitsluitend in de Function App Settings (of Key Vault),
  nooit in de repo of de bundle.

## Wat verify.mjs afdwingt (in CI, elke deploy)

`scripts/verify.mjs` leest de live omgeving terug en print één JSON-rapport
(`{ pass, failures, summary }`); één failure = rode CI-run. Scopes:

- **schema** (na deploy-solution): de 6 `gd_`-tabellen bestaan; alle 7 statuscodes van
  `gd_supportticket` (incl. de 12269xxxx-waarden en Closed onder statecode 1); autonumber
  `VEL-{SEQNUM:5}`; file-kolom `gd_file` met MaxSizeInKB 32768; `gd_internalnote.HasNotes`;
  de 4 global option sets met exacte labels én de check dat **alle** waarden in het
  12269xxxx-blok zitten; role "VelOps Support"; app module `gd_VelopsSupportHub`.
- **data** (na deploy-solution): ≥ 10 `gd_app`-rijen; met `SMOKE=1` ook een echte
  create+delete van een smoke-ticket met assert op `^VEL-\d{5}$`.
- **portal** (na configure-portal): mspp_website bestaat (site geactiveerd); alle 7 table
  permissions bestaan én zijn gelinkt aan Authenticated Users; alle site settings staan er.
  Plus de **negatieve asserts** (D1): **nul** table permissions en **nul** `Webapi/*`-site
  settings voor `gd_internalnote` of `annotation` — komt er ooit één bij, dan faalt de CI.

Losse noot: site setting `Webapi/error/innererror` staat tijdens de bouwfase op `true`
(diagnostiek) en gaat in de hardening-fase naar `false`.
