// READ-ONLY: dump the most recent gd_supportticket rows with the fields that
// decide portal visibility (gd_account / gd_contact / state / status), so we can
// tell whether a just-created ticket carries the account the Account-scoped
// table permission filters on. Also prints the demo contact's parent account so
// the two can be compared by eye.
// Usage (CI): node scripts/inspect-recent-tickets.mjs
//   optional: CONTACT_ID=<guid> to resolve a specific signup's account.

import { api, fail, whoami } from "./lib/dataverse.mjs";

const CONTACT_ID = process.env.CONTACT_ID || "d7382d3a-3584-f111-8076-000d3adce9a0";

async function main() {
  await whoami();

  // The signup contact and its parent account (what the ticket SHOULD carry).
  const contact = await api(
    `contacts(${CONTACT_ID})?$select=contactid,fullname,_parentcustomerid_value`,
    { allow404: true },
  ).catch((e) => ({ _err: String(e.message || e).slice(0, 120) }));
  if (contact && !contact._err) {
    console.error(
      `signup contact: ${contact.fullname} (${contact.contactid})\n` +
        `  parent account: ${contact["_parentcustomerid_value@OData.Community.Display.V1.FormattedValue"]}` +
        ` (${contact._parentcustomerid_value})`,
    );
  } else {
    console.error(`signup contact ${CONTACT_ID}: ${contact?._err || "not found"}`);
  }

  const { value: tickets } = await api(
    `gd_supporttickets?$select=gd_supportticketid,gd_ticketnumber,gd_name,statecode,statuscode,` +
      `createdon,_gd_account_value,_gd_contact_value,_gd_app_value&$orderby=createdon desc&$top=10`,
  );
  console.error(`\nmost recent ${tickets.length} ticket(s):`);
  for (const t of tickets) {
    console.error(
      `  ${t.gd_ticketnumber || "(no #)"}  "${t.gd_name}"\n` +
        `     state=${t.statecode} status=${t.statuscode} created=${t.createdon}\n` +
        `     account=${t["_gd_account_value@OData.Community.Display.V1.FormattedValue"] || "(none)"} (${t._gd_account_value || "null"})\n` +
        `     contact=${t["_gd_contact_value@OData.Community.Display.V1.FormattedValue"] || "(none)"} (${t._gd_contact_value || "null"})`,
    );
  }

  console.log(JSON.stringify({
    total: tickets.length,
    withoutAccount: tickets.filter((t) => !t._gd_account_value).length,
  }));
}

main().catch(fail);
