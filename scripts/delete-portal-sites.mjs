// One-off ops script: delete ALL Power Pages sites named "VelOps Support" in the
// target environment. Used to clean up the duplicate half-uploaded inactive code
// sites created by failed `pac pages upload-code-site` runs (2026-07-19).
//
// The enhanced data model stores a site as one `powerpagesite` row plus
// `powerpagecomponent` child rows (the mspp_* tables are virtual projections of
// these). Deleting the powerpagesite row is the canonical full-site delete; any
// straggler components are swept afterwards as belt-and-braces.
//
// Usage (CI): node scripts/delete-portal-sites.mjs
// Env: DATAVERSE_URL, POWERPLATFORM_CLIENT_ID/SECRET/TENANT_ID (see lib/dataverse.mjs)

import { api, fail, whoami } from "./lib/dataverse.mjs";

const SITE_NAME = "VelOps Support";

async function main() {
  await whoami();

  const { value: sites } = await api(
    "powerpagesites?$select=powerpagesiteid,name,createdon&$orderby=createdon asc",
  );
  console.error(`Found ${sites.length} powerpagesite row(s) in the environment:`);
  for (const s of sites) console.error(`  - ${s.name}  (${s.powerpagesiteid}, created ${s.createdon})`);

  const targets = sites.filter((s) => s.name === SITE_NAME);
  if (targets.length === 0) {
    console.log(JSON.stringify({ deleted: 0, message: `no sites named '${SITE_NAME}' found` }));
    return;
  }

  const deleted = [];
  for (const s of targets) {
    console.error(`Deleting site '${s.name}' ${s.powerpagesiteid} (created ${s.createdon}) ...`);
    await api(`powerpagesites(${s.powerpagesiteid})`, { method: "DELETE" });
    deleted.push(s.powerpagesiteid);
  }

  // Belt-and-braces: components should cascade with the site; sweep any stragglers.
  let stragglers = 0;
  for (const id of deleted) {
    const { value: comps } = await api(
      `powerpagecomponents?$select=powerpagecomponentid&$filter=_powerpagesiteid_value eq ${id}`,
      { allow404: true },
    ).catch(() => ({ value: [] }));
    for (const c of comps ?? []) {
      await api(`powerpagecomponents(${c.powerpagecomponentid})`, { method: "DELETE" });
      stragglers++;
    }
  }

  const { value: after } = await api("powerpagesites?$select=name");
  console.log(
    JSON.stringify({
      deleted: deleted.length,
      straggler_components_deleted: stragglers,
      sites_remaining: after.map((s) => s.name),
    }),
  );
}

main().catch(fail);
