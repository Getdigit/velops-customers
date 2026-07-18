# BRANDING-AUTH — wat wél/niet brandbaar is aan login & registratie

## Situatie

Het portaal is een Power Pages **code site**: wij leveren alleen de SPA-bundle
(`portal/dist`). Inloggen en registreren zijn **platform-hosted pagina's** van Power
Pages zelf — `/Account/Login` en `/Account/Login/Register` — gerenderd buiten onze
bundle om. Een code site heeft geen Liquid/SSR-laag, dus er is **geen hook om CSS of
markup in die pagina's te injecteren**.

## Wél / niet

| | Kan | Kan niet |
|---|---|---|
| **Gedrag** | Registratie open/dicht, local login, redirect na login (`ReturnUrl`) — allemaal via **site settings** (zie onder) | — |
| **Styling** | — | CSS/fonts/kleuren van `/Account/Login*` aanpassen vanuit de code site; eigen header/footer op die pagina's |
| **Tekst** | Sitenaam die het platform toont = de site display name (**"VelOps Support"** — bewust zo gekozen, dit is ons enige "brandmoment" dáár) | Overige copy op de platform-pagina's |
| **Flow** | Vanuit de SPA linken: **Sign in** → `/Account/Login?ReturnUrl=%2Ftickets`, **Create an account** → `/Account/Login/Register`; na login landt de gebruiker terug in de SPA | De pagina's overslaan of vervangen door een eigen loginform (auth blijft platform-hosted) |

**Conclusie / ontwerpkeuze:** de merk-momenten zijn de **gebrande landingpagina** (`/`) en
alles **in de SPA** (tokens, Saira, mockup-CSS). De login/registratie-stap ertussen is een
neutraal, herkenbaar Microsoft-moment van enkele seconden — dat accepteren we in v1.

## Gebruikte site settings (gezet door `scripts/configure-portal.mjs`)

Auth-gedrag:

| Site setting | Waarde | Effect |
|---|---|---|
| `Authentication/Registration/Enabled` | `true` | Registratie/aanmeldflow aan |
| `Authentication/Registration/OpenRegistrationEnabled` | `true` | **Open registratie**: iedereen kan een account aanmaken zonder invitation code (de pending-gate + account-koppeling is onze poort, zie [SECURITY.md](SECURITY.md)) |

Overige settings uit hetzelfde script (geen auth-branding, hier voor volledigheid):
`Webapi/<tabel>/enabled` + `Webapi/<tabel>/fields` (`*`) voor de zes portaal-tabellen
(`gd_supportticket`, `gd_supportmessage`, `gd_ticketattachment`, `gd_accountapp`, `gd_app`,
`contact`) en `Webapi/error/innererror` (`true` tijdens de bouwfase).

Niet geconfigureerd in v1 (backlog-opties, ook site settings): externe identity providers
beperken/forceren, local login uitzetten, invitation-only registratie.

## Waar de merk-momenten dan wél zitten

- **Landing (`/`, publiek):** logo, hero, uitleg "how it works", de twee CTA's naar de
  platform-pagina's — volledig in eigen huisstijl (mockup 1:1).
- **In de SPA (ingelogd):** alle schermen, statussen, e-mails-of-toasts, pending-gate —
  eigen `--vel-*` tokens en componenten; het platform is hier onzichtbaar.
- **Site display name:** "VelOps Support" verschijnt op de platform-loginpagina's — houd
  die naam dus schoon/klantwaardig (geen interne codenamen).
