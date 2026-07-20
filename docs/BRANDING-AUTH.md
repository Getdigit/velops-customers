# BRANDING-AUTH — wat wél/niet brandbaar is aan login & registratie

## Situatie

Het portaal is een Power Pages **code site**: wij leveren alleen de SPA-bundle
(`portal/dist`). Inloggen en registreren zijn **platform-hosted pagina's** van Power
Pages zelf, gerenderd buiten onze bundle om. Er zijn twee families endpoints:

- **`/SignIn`** (modern, mét tabbladen Sign in / Register / Redeem invitation): laadt de
  **site-webfiles** `bootstrap.min.css` + `portalbasictheme.css` + `theme.css` — en dus
  ook onze VelOps-overrides in `portal/platform-theme/theme.css` (Saira, geel/inkt,
  papier-achtergrond). **Dit is het endpoint dat de SPA gebruikt.**
- **`/Account/Login`** (legacy): laadt géén site-css en rendert altijd kaal — niet naar
  linken. (`/Account/Login/Register` en `/Account/Login/LogOff` komen wel goed terecht
  in de gestylede flow.)

## Wél / niet (bijgewerkt 20-07-2026)

| | Kan | Kan niet |
|---|---|---|
| **Gedrag** | Registratie open/dicht, local login, redirect na login (`ReturnUrl`) — allemaal via **site settings** (zie onder) | — |
| **Styling** | `/SignIn` + registratie/profiel stylen via de **theme-webfiles** (`portal/platform-theme/theme.css`, uitgerold met `scripts/apply-platform-theme.mjs`) | Markup/structuur van de platform-pagina's wijzigen; het legacy `/Account/Login` stylen |
| **Tekst** | Sitenaam die het platform toont = de site display name (**"VelOps Support"**) | Overige copy op de platform-pagina's |
| **Flow** | Vanuit de SPA linken: **Sign in** → `/SignIn?ReturnUrl=%2Ftickets`, **Create an account** → `/Account/Login/Register`; na login landt de gebruiker terug in de SPA | De pagina's overslaan of vervangen door een eigen loginform (auth blijft platform-hosted) |

**Conclusie:** de merk-momenten zijn de gebrande landingpagina (`/`), alles in de SPA, én
sinds 20-07 ook de sign-in/registratie-pagina's zelf (Saira + geel/inkt via theme.css).

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
