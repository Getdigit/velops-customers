// READ-ONLY: inspect the freshly-registered portal contact and the teams it
// could be linked to. The portal shows the "awaiting activation" pending gate
// whenever the contact has no parentcustomerid (team) — this confirms that
// state and lists the Accounts available to link it to.
// Usage (CI): node scripts/inspect-contact.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

const CONTACT_ID = "d7382d3a-3584-f111-8076-000d3adce9a0";

async function main() {
  await whoami();

  const c = await api(
    `contacts(${CONTACT_ID})?$select=contactid,fullname,firstname,lastname,emailaddress1,` +
      `_parentcustomerid_value,statecode,statuscode,createdon,adx_identity_username,adx_identity_logonenabled`,
  ).catch((e) => ({ _error: String(e.message || e).slice(0, 200) }));

  if (c._error) {
    console.log(JSON.stringify({ contact: null, error: c._error }));
    return;
  }
  console.error("=== contact ===");
  console.error(JSON.stringify({
    name: c.fullname,
    email: c.emailaddress1,
    portalUsername: c.adx_identity_username,
    logonEnabled: c.adx_identity_logonenabled,
    team_parentcustomerid: c._parentcustomerid_value || "(none — this is why the portal shows 'awaiting activation')",
    teamName: c["_parentcustomerid_value@OData.Community.Display.V1.FormattedValue"] || null,
    statecode: c.statecode,
    createdon: c.createdon,
  }, null, 1));

  // Teams (Accounts) available to link the contact to.
  const { value: accounts } = await api(
    "accounts?$select=accountid,name&$orderby=createdon desc&$top=25",
  );
  console.error(`\n=== accounts (teams) available: ${accounts.length} ===`);
  for (const a of accounts) console.error(`  - ${a.name}  (${a.accountid})`);

  // Any team-apps seeded? (the New-ticket "Product area" dropdown is fed by
  // the team's linked apps — an empty team makes that dropdown empty.)
  const { value: apps } = await api("gd_apps?$select=gd_name,gd_appid&$orderby=gd_name asc");
  console.error(`\n=== gd_app catalogue: ${apps.length} ===`);
  for (const a of apps) console.error(`  - ${a.gd_name}`);

  console.log(JSON.stringify({
    contactLinked: !!c._parentcustomerid_value,
    accountsAvailable: accounts.length,
    appsSeeded: apps.length,
  }));
}

main().catch(fail);
