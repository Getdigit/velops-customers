// Smoke-test the /api/portalwrite Function endpoint end-to-end WITHOUT a portal
// session: call it exactly as the SPA does (function key), assert it creates a
// ticket + message with the account DERIVED server-side from the contact, then
// clean both up with the SPN. Proves the server-side write path works before a
// human login test.
//
// Env (run-script.yml passes these): VITE_AI_PROXY_URL, VITE_AI_PROXY_KEY, plus
// DATAVERSE_URL + POWERPLATFORM_* (SPN, for the resolve + cleanup).
// Optional: SMOKE_CONTACT_ID (defaults to the demo contact).

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

const CONTACT_ID = process.env.SMOKE_CONTACT_ID || "d7382d3a-3584-f111-8076-000d3adce9a0";

function writeEndpoint() {
  const base = process.env.VITE_AI_PROXY_URL || "";
  const key = process.env.VITE_AI_PROXY_KEY || "";
  if (!base) fail("VITE_AI_PROXY_URL is not set — cannot locate the portalwrite endpoint.");
  const url = base.replace(/\/api\/messages\/?(\?.*)?$/, "/api/portalwrite$1");
  return key ? `${url}${url.includes("?") ? "&" : "?"}code=${encodeURIComponent(key)}` : url;
}

async function callWrite(action, payload) {
  const res = await fetch(writeEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

async function main() {
  await whoami();

  // The account we EXPECT the function to derive (contact's parentcustomerid).
  const contact = await api(`contacts(${CONTACT_ID})?$select=contactid,_parentcustomerid_value`, { allow404: true });
  if (!contact) fail(`smoke contact ${CONTACT_ID} not found`);
  const expectedAccount = (contact._parentcustomerid_value || "").toLowerCase();
  console.error(`contact ${CONTACT_ID} -> expected account ${expectedAccount || "(none!)"}`);

  const failures = [];
  let ticketId = null;
  let messageId = null;

  // 1. createTicket
  const t = await callWrite("createTicket", {
    contactId: CONTACT_ID,
    subject: "smoke-portalwrite ticket (safe to delete)",
    description: "Created by scripts/smoke-portalwrite.mjs to verify the server-side write path.",
    tickettype: 122690002, // Bug
    priority: 122690001, // Medium
  });
  console.error(`createTicket -> HTTP ${t.status}`);
  if (t.status !== 200 || !t.json.value) {
    failures.push(`createTicket failed: ${JSON.stringify(t.json).slice(0, 400)}`);
  } else {
    const row = t.json.value;
    ticketId = row.gd_supportticketid;
    const num = row.gd_ticketnumber || "";
    const acct = (row._gd_account_value || "").toLowerCase();
    console.error(`  ticket ${num} (${ticketId}) account=${acct}`);
    if (!/^VEL-\d{5}$/.test(num)) failures.push(`ticket number not VEL-#####: ${JSON.stringify(num)}`);
    if (acct !== expectedAccount) failures.push(`account not derived: got ${acct || "(none)"}, expected ${expectedAccount}`);
    if ((row._gd_contact_value || "").toLowerCase() !== CONTACT_ID.toLowerCase()) failures.push("contact not bound");
  }

  // 2. createMessage on that ticket
  if (ticketId) {
    const m = await callWrite("createMessage", { contactId: CONTACT_ID, ticketId, body: "smoke message body" });
    console.error(`createMessage -> HTTP ${m.status}`);
    if (m.status !== 200 || !m.json.value) {
      failures.push(`createMessage failed: ${JSON.stringify(m.json).slice(0, 400)}`);
    } else {
      messageId = m.json.value.gd_supportmessageid;
      console.error(`  message ${messageId}`);
    }

    // 3. cross-team guard: a message for a DIFFERENT contact must be refused (403).
    const guard = await callWrite("createMessage", { contactId: "00000000-0000-0000-0000-000000000001", ticketId, body: "should be rejected" });
    if (guard.status === 200) failures.push("cross-team/invalid-contact message was NOT rejected");
    else console.error(`  guard (bad contact) correctly rejected -> HTTP ${guard.status}`);
  }

  // 4. cleanup with the SPN.
  if (messageId) await api(`gd_supportmessages(${messageId})`, { method: "DELETE" }).catch((e) => console.error(`(msg cleanup warn: ${e.message})`));
  if (ticketId) await api(`gd_supporttickets(${ticketId})`, { method: "DELETE" }).catch((e) => console.error(`(ticket cleanup warn: ${e.message})`));
  console.error("cleaned up smoke records");

  console.log(JSON.stringify({ pass: failures.length === 0, failures }, null, 2));
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch(fail);
