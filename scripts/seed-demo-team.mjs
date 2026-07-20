// One-off: create a demo team (Account) with a few app links, and link the
// pending portal contact to it — so the "awaiting activation" gate clears and
// the New-ticket "Product area" dropdown is populated. Idempotent: reuses an
// existing "VelOps Demo Team" and skips app links / the contact link if already
// present. Fully reversible (delete the account + its gd_accountapps, null the
// contact's parentcustomerid).
// Usage (CI): node scripts/seed-demo-team.mjs

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

const CONTACT_ID = "d7382d3a-3584-f111-8076-000d3adce9a0";
const TEAM_NAME = "VelOps Demo Team";
const APP_NAMES = ["Rider App", "Team Hub", "Fleet", "Mechanic Hub", "Travel & Logistics"];

async function main() {
  await whoami();

  // 1. Team (Account) — reuse if it already exists.
  const found = await api(`accounts?$select=accountid,name&$filter=name eq ${odataQuote(TEAM_NAME)}`);
  let accountId = found.value[0]?.accountid;
  if (accountId) {
    console.error(`team exists: ${TEAM_NAME} (${accountId})`);
  } else {
    const acc = await api("accounts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { name: TEAM_NAME },
    });
    accountId = acc.accountid;
    console.error(`team created: ${TEAM_NAME} (${accountId})`);
  }

  // 2. Link apps to the team (skip ones already linked).
  const { value: existingLinks } = await api(
    `gd_accountapps?$select=_gd_app_value&$filter=_gd_account_value eq ${accountId}`,
  );
  const linkedAppIds = new Set(existingLinks.map((l) => l._gd_app_value));
  let linked = 0;
  for (const name of APP_NAMES) {
    const apps = await api(`gd_apps?$select=gd_appid&$filter=gd_name eq ${odataQuote(name)}`);
    const appId = apps.value[0]?.gd_appid;
    if (!appId) { console.error(`  ! app not found: ${name}`); continue; }
    if (linkedAppIds.has(appId)) { console.error(`  = already linked: ${name}`); continue; }
    await api("gd_accountapps", {
      method: "POST",
      body: {
        gd_name: `${TEAM_NAME} - ${name}`,
        "gd_Account@odata.bind": `/accounts(${accountId})`,
        "gd_App@odata.bind": `/gd_apps(${appId})`,
      },
    });
    linked++;
    console.error(`  + linked app: ${name}`);
  }

  // 3. Link the pending contact to the team (clears the awaiting-activation gate).
  const c = await api(`contacts(${CONTACT_ID})?$select=_parentcustomerid_value,fullname,emailaddress1`);
  if (c._parentcustomerid_value === accountId) {
    console.error(`contact already linked to ${TEAM_NAME}`);
  } else {
    await api(`contacts(${CONTACT_ID})`, {
      method: "PATCH",
      body: { "parentcustomerid_account@odata.bind": `/accounts(${accountId})` },
    });
    console.error(`contact ${c.emailaddress1} linked to ${TEAM_NAME}`);
  }

  // Verify
  const check = await api(`contacts(${CONTACT_ID})?$select=_parentcustomerid_value`);
  console.log(JSON.stringify({
    team: TEAM_NAME,
    accountId,
    appsLinkedNow: linked,
    contactLinked: check._parentcustomerid_value === accountId,
  }));
}

main().catch(fail);
