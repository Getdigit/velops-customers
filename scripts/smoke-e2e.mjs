// End-to-end DATA-PATH smoke test via the SPN: walks the full ticket lifecycle
// against the live schema — demo team + contact + app link, ticket (autonumber),
// public message, internal note, attachment with a REAL file-column upload and
// download, every status transition, satisfaction rating — then deletes
// everything it created (and only that; ids are captured at creation time).
// Portal table permissions are NOT exercised here (the SPN bypasses them);
// verify.mjs portal scope + the manual RUNBOOK ⑥ checklist cover those.
// Usage (CI): node scripts/smoke-e2e.mjs

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.error(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const created = { accountapp: null, ticket: null, contact: null, account: null };

async function run() {
  await whoami();

  // Demo team + submitter + app link
  const account = await api("accounts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: { name: "SMOKE Demo Team (auto-created, auto-deleted)" },
  });
  created.account = account.accountid;
  check("account created", !!account.accountid);

  const contact = await api("contacts", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      firstname: "Smoke",
      lastname: "Test",
      "parentcustomerid_account@odata.bind": `/accounts(${account.accountid})`,
    },
  });
  created.contact = contact.contactid;
  check("contact created + linked to team", !!contact.contactid);

  const apps = await api(`gd_apps?$select=gd_appid&$filter=gd_name eq ${odataQuote("Rider App")}`);
  const appId = apps.value[0]?.gd_appid;
  check("seeded app 'Rider App' found", !!appId);

  const accountApp = await api("gd_accountapps", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      gd_name: "SMOKE Demo Team - Rider App",
      "gd_Account@odata.bind": `/accounts(${account.accountid})`,
      "gd_App@odata.bind": `/gd_apps(${appId})`,
    },
  });
  created.accountapp = accountApp.gd_accountappid;
  check("team-app link created", !!accountApp.gd_accountappid);

  // Ticket with autonumber
  const ticket = await api("gd_supporttickets", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      gd_name: "SMOKE: sync fails on iOS (auto-deleted)",
      gd_description: "End-to-end smoke ticket created by scripts/smoke-e2e.mjs.",
      gd_tickettype: 122690002, // Bug
      gd_priority: 122690001, // Medium
      gd_source: 122690000, // Portal form
      "gd_Account@odata.bind": `/accounts(${account.accountid})`,
      "gd_Contact@odata.bind": `/contacts(${contact.contactid})`,
      "gd_App@odata.bind": `/gd_apps(${appId})`,
    },
  });
  created.ticket = ticket.gd_supportticketid;
  check("ticket created with VEL-##### autonumber", /^VEL-\d{5}$/.test(ticket.gd_ticketnumber || ""),
    `got ${JSON.stringify(ticket.gd_ticketnumber ?? null)}`);
  console.error(`  (ticket ${ticket.gd_ticketnumber})`);

  // Thread: public message + internal note
  const message = await api("gd_supportmessages", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      gd_name: "SMOKE first message",
      gd_body: "Since this morning the Rider App no longer syncs on iOS.",
      gd_direction: 122690000, // Customer
      gd_authorname: "Smoke Test",
      "gd_Ticket@odata.bind": `/gd_supporttickets(${ticket.gd_supportticketid})`,
      "gd_AuthorContact@odata.bind": `/contacts(${contact.contactid})`,
    },
  });
  check("public message created on thread", !!message.gd_supportmessageid);

  const note = await api("gd_internalnotes", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      gd_name: "SMOKE internal note",
      gd_body: "Internal-only: likely the token refresh regression.",
      gd_authorname: "VelOps Smoke",
      "gd_Ticket@odata.bind": `/gd_supporttickets(${ticket.gd_supportticketid})`,
    },
  });
  check("internal note created", !!note.gd_internalnoteid);

  // Attachment: row + real file-column upload + download readback
  const attachment = await api("gd_ticketattachments", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      gd_name: "smoke.txt",
      gd_mimetype: "text/plain",
      gd_isimage: false,
      "gd_Ticket@odata.bind": `/gd_supporttickets(${ticket.gd_supportticketid})`,
      "gd_Message@odata.bind": `/gd_supportmessages(${message.gd_supportmessageid})`,
    },
  });
  check("attachment row created", !!attachment.gd_ticketattachmentid);

  const FILE_BODY = "hello from smoke-e2e.mjs - file column round trip";
  await api(`gd_ticketattachments(${attachment.gd_ticketattachmentid})/gd_file`, {
    method: "PATCH",
    headers: { "Content-Type": "application/octet-stream", "x-ms-file-name": "smoke.txt" },
    body: FILE_BODY,
  });
  const downloaded = await api(`gd_ticketattachments(${attachment.gd_ticketattachmentid})/gd_file/$value`);
  check("file column upload + download round trip", downloaded === FILE_BODY,
    `got ${JSON.stringify(String(downloaded).slice(0, 60))}`);

  // Status transitions: New -> In Progress -> Resolved (+rating) -> Closed -> reopen
  const setStatus = (statecode, statuscode) =>
    api(`gd_supporttickets(${ticket.gd_supportticketid})`, { method: "PATCH", body: { statecode, statuscode } });
  const readStatus = async () => {
    const t = await api(`gd_supporttickets(${ticket.gd_supportticketid})?$select=statecode,statuscode,gd_satisfactionrating`);
    return t;
  };

  await setStatus(0, 122690002);
  check("transition New -> In Progress", (await readStatus()).statuscode === 122690002);
  await setStatus(0, 122690005);
  await api(`gd_supporttickets(${ticket.gd_supportticketid})`, { method: "PATCH", body: { gd_satisfactionrating: 5 } });
  const resolved = await readStatus();
  check("transition -> Resolved + rating 5", resolved.statuscode === 122690005 && resolved.gd_satisfactionrating === 5,
    `status ${resolved.statuscode}, rating ${resolved.gd_satisfactionrating}`);
  await setStatus(1, 2);
  check("transition -> Closed (inactive)", (await readStatus()).statecode === 1);
  await setStatus(0, 122690002);
  check("reopen Closed -> In Progress", (await readStatus()).statuscode === 122690002);
}

async function cleanup() {
  console.error("  cleaning up ...");
  if (created.ticket) {
    await api(`gd_supporttickets(${created.ticket})`, { method: "DELETE" }).catch((e) =>
      check("cleanup: ticket deleted", false, String(e?.message || e).slice(0, 120)));
    // Children must cascade with the ticket (relationship cascade contract).
    const [msgs, notes, atts] = await Promise.all([
      api(`gd_supportmessages?$select=gd_supportmessageid&$filter=_gd_ticket_value eq ${created.ticket}`),
      api(`gd_internalnotes?$select=gd_internalnoteid&$filter=_gd_ticket_value eq ${created.ticket}`),
      api(`gd_ticketattachments?$select=gd_ticketattachmentid&$filter=_gd_ticket_value eq ${created.ticket}`),
    ]);
    check("cascade delete removed thread children",
      msgs.value.length === 0 && notes.value.length === 0 && atts.value.length === 0,
      `messages ${msgs.value.length}, notes ${notes.value.length}, attachments ${atts.value.length}`);
  }
  if (created.accountapp) await api(`gd_accountapps(${created.accountapp})`, { method: "DELETE" }).catch(() => {});
  if (created.contact) await api(`contacts(${created.contact})`, { method: "DELETE" }).catch(() => {});
  if (created.account) await api(`accounts(${created.account})`, { method: "DELETE" }).catch(() => {});
  console.error("  cleanup done.");
}

async function main() {
  try {
    await run();
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify({ pass: failures.length === 0, passed, failures }));
  if (failures.length > 0) process.exit(1);
}

main().catch(fail);
