// READ-ONLY: list every contact with its portal-identity + team link, to catch
// the two things that keep the portal on "awaiting activation" after a link:
//  - a DUPLICATE contact (the logged-in portal user maps to a different row
//    than the one that got linked), or
//  - the linked account being inactive / unreadable.
// Usage (CI): node scripts/audit-contacts.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

async function main() {
  await whoami();

  const { value: contacts } = await api(
    "contacts?$select=contactid,fullname,emailaddress1,adx_identity_username," +
      "adx_identity_logonenabled,_parentcustomerid_value,statecode,createdon&$orderby=createdon asc",
  );
  console.error(`=== ${contacts.length} contact(s) ===`);
  for (const c of contacts) {
    console.error(JSON.stringify({
      id: c.contactid,
      name: c.fullname,
      email: c.emailaddress1,
      username: c.adx_identity_username,
      logon: c.adx_identity_logonenabled,
      team: c["_parentcustomerid_value@OData.Community.Display.V1.FormattedValue"] || null,
      teamId: c._parentcustomerid_value || null,
      statecode: c.statecode,
      createdon: c.createdon,
    }));
  }

  // Active accounts the portal could read.
  const { value: accounts } = await api("accounts?$select=accountid,name,statecode&$orderby=name asc");
  console.error(`\n=== ${accounts.length} account(s) ===`);
  for (const a of accounts) {
    console.error(`  - ${a.name}  (${a.accountid})  statecode=${a.statecode}`);
  }

  const linked = contacts.filter((c) => c._parentcustomerid_value);
  const dupUsernames = {};
  for (const c of contacts) {
    const u = (c.adx_identity_username || "").toLowerCase();
    if (u) (dupUsernames[u] ||= []).push(c.contactid);
  }
  const duplicates = Object.entries(dupUsernames).filter(([, ids]) => ids.length > 1);

  console.log(JSON.stringify({
    contacts: contacts.length,
    linkedContacts: linked.length,
    accounts: accounts.length,
    duplicateUsernames: duplicates.map(([u, ids]) => ({ username: u, ids })),
  }));
}

main().catch(fail);
