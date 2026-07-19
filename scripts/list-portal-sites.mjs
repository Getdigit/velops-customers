// READ-ONLY ops script: inventory of Power Pages site rows in the environment.
// Prints, per mspp_website: id, name, primary domain (set on the ACTIVATED site),
// createdon, plus per-site counts of web files and entity permissions — so we can
// tell which row is the live site (site-kgbyt.powerappsportals.com), which rows
// are stale duplicate shells, and where configure-portal's records landed.
// Usage (CI): node scripts/list-portal-sites.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

async function count(path) {
  const r = await api(path, { allow404: true }).catch(() => null);
  return r?.value?.length ?? "n/a";
}

async function main() {
  await whoami();

  const { value: pps } = await api("powerpagesites?$select=powerpagesiteid,createdon&$orderby=createdon asc");
  console.error(`powerpagesite rows: ${pps.length}`);
  for (const s of pps) console.error(`  - ${s.powerpagesiteid}  created ${s.createdon}`);

  const { value: sites } = await api(
    "mspp_websites?$select=mspp_websiteid,mspp_name,mspp_primarydomainname,createdon&$orderby=createdon asc",
  );
  const report = [];
  for (const w of sites) {
    report.push({
      id: w.mspp_websiteid,
      name: w.mspp_name,
      primarydomain: w.mspp_primarydomainname ?? null,
      createdon: w.createdon,
      webfiles: await count(
        `mspp_webfiles?$select=mspp_webfileid&$filter=_mspp_websiteid_value eq ${w.mspp_websiteid}`,
      ),
      permissions: await count(
        `mspp_entitypermissions?$select=mspp_entitypermissionid&$filter=_mspp_websiteid_value eq ${w.mspp_websiteid}`,
      ),
      sitesettings: await count(
        `mspp_sitesettings?$select=mspp_sitesettingid&$filter=_mspp_websiteid_value eq ${w.mspp_websiteid}`,
      ),
    });
  }
  console.log(JSON.stringify({ mspp_websites: report }, null, 2));
}

main().catch(fail);
