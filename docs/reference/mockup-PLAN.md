# VelOps Customer Support Portal — Plan

**Goal:** a portal where VelOps customers (cycling teams) submit questions and complaints, follow up on them in a conversation thread with the VelOps team, and always see the current status (In Review, In Progress, In Development, Done, …). Portal UI is **English**. Delivery in two steps: **(1)** HTML mockup to validate the UX (this folder), **(2)** production build as a **Power Pages SPA** backed by Dataverse.

---

## 1. Scope & core flows

| Flow | Description |
|---|---|
| Submit a ticket | Customer contact logs in, fills in subject, type, priority, product area and description (+ optional attachment) |
| Conversation | VelOps team replies; the customer replies back — a full back-and-forth thread per ticket, visible in the portal |
| Status tracking | Every ticket shows its live status + a step tracker (Submitted → In Review → In Progress / In Development → Resolved → Closed) |
| Waiting on customer | When VelOps needs input, status flips to *Waiting on Customer* so it's obvious who has the ball |
| Close & satisfaction | On *Resolved* the customer confirms (or reopens); optional 1–5 satisfaction rating on close |
| Team side | VelOps handles tickets in the model-driven hub (views per status/priority), sets status, replies, writes internal notes invisible to the customer |

### Ticket fields (customer-facing)

- **Ticket number** — autonumber, e.g. `VEL-01042`
- **Subject** (single line) + **Description** (multiline)
- **Type** — Question / Complaint / Bug / Feature Request
- **Priority** — Low / Medium / High / Critical
- **Product area** — Rider App / Team Hub / Planning & Calendar / Travel & Logistics / Fleet / Reports & Data / Account & Licensing / Other
- **Status** — New → In Review → In Progress → In Development → Waiting on Customer → Resolved → Closed (Resolved can be reopened by the customer)
- **Attachments** — optional, on the ticket and on replies

### Internal-only fields

- Assigned VelOps owner, internal notes (never rendered in the portal), linked dev work item reference, resolution summary.

## 2. Data model (Dataverse, in the `Veloops` solution)

Custom `gd_` tables — deliberately **not** the Dynamics `incident`/Case table, to stay white-label, licence-light and inside the unmanaged Veloops solution:

| Table | Purpose | Key columns |
|---|---|---|
| `gd_supportticket` | The ticket | autonumber `gd_ticketnumber`; `gd_subject`; `gd_description`; choices `gd_tickettype`, `gd_priority`, `gd_productarea`; statuscode = ticket status; lookups: customer **Account** (team) + submitting **Contact**; `gd_resolutionsummary`; `gd_satisfactionrating` |
| `gd_supportmessage` | One message in the thread | lookup → ticket; `gd_body` (multiline); `gd_direction` (Customer / VelOps Team); `gd_isinternal` (bool — internal notes, never exposed via portal table permissions); author contact / systemuser |

Attachments via annotations (notes) or file columns — Power Pages supports both. New global option sets: `gd_tickettype`, `gd_ticketpriority`, `gd_productarea` (status lives in `statuscode` on the ticket).

**Security decision (proposed):** table permissions **account-scoped** — every contact of a team sees all tickets of their team (a team manager wants the full picture). Can be tightened to contact-scoped later if a customer asks.

## 3. Portal (step 2 — Power Pages SPA)

- **Power Pages site** with a React SPA (Vite + TS), same pattern as the existing VelOps code apps; data via the Power Pages **Web API** against the two tables above.
- **Auth:** Power Pages authentication (Entra External ID / invitation-based), mapped to the existing **Contact** rows. New web role `Portal Customer` + table permissions (ticket: account scope, create/read/write-own; message: parent-scope via ticket, create/read, filtered `gd_isinternal = false`).
- **Design:** VelOps design system v2 fully in-code (same `--vel-*` tokens as the hub app) — the mockup in this folder is the reference; per-client rebranding stays a token-file swap.
- **Screens:** My Tickets (list + filters) · New Ticket · Ticket Detail (thread + status tracker + reply composer).

## 4. Team side & automation

- **Model-driven:** add `gd_supportticket` + `gd_supportmessage` to `gd_TeamOperationsHub` (new "Support" area): views *My open tickets*, *All open by priority*, *Waiting on customer*, *In development*; form with thread subgrid + internal notes.
- **Power Automate flows:**
  1. New ticket → notify VelOps (mail/Teams) + acknowledgement mail to the customer with the ticket number.
  2. New VelOps reply or status change → notify the submitting contact.
  3. New customer reply → notify assigned owner; auto-flip *Waiting on Customer* back to *In Progress*.

## 5. Phasing

1. **Mockup (now):** `velops-support-portal-mockup.html` — self-contained, sample data, customer + VelOps-team view toggle. Validate flows & wording.
2. **Schema:** tables/choices/autonumber in Veloops solution (export → edit → version bump → import, per the mandatory workflow).
3. **Portal:** Power Pages site + SPA scaffold, auth + table permissions, the three screens.
4. **Team side + flows:** hub views/forms, the three notification flows.
5. **Polish (optional):** attachments UX, satisfaction rating, FAQ/knowledge links (reuse `gd_infolink`), public "in development" roadmap view, SLA/first-response indicator.

## 6. Open decisions

- Account-scoped vs contact-scoped visibility (proposal: account).
- Notification channel for VelOps (mail vs Teams-kanaal).
- Whether *Feature Request* tickets feed a public roadmap view in the portal (nice upsell moment, phase 5).
