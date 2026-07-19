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

async function main() {
  await whoami();

  // NOTE: powerpagesite.name comes back null via the Web API (the display name
  // lives inside the site's content JSON), so a name filter matches nothing.
  // Instead we pin the EXACT ids of the three duplicate shells observed in the
  // 2026-07-19 Run Ops Script log (one per failed upload-code-site run).
  const TARGET_IDS = [
    "a082b582-394e-4b0e-a0e3-72ee50e7b4d1", // created 2026-07-19T12:13:00Z (deploy-portal run 2)
    "be6556ff-6a93-44e0-91f8-e4330011e729", // created 2026-07-19T12:18:03Z (deploy-portal run 3)
    "a2d2665c-79db-42b2-8d88-704bac6837e7", // created 2026-07-19T12:24:01Z (deploy-portal run 4)
  ];

  const { value: sites } = await api(
    "powerpagesites?$select=powerpagesiteid,name,createdon&$orderby=createdon asc",
  );
  console.error(`Found ${sites.length} powerpagesite row(s) in the environment:`);
  for (const s of sites) console.error(`  - ${s.name}  (${s.powerpagesiteid}, created ${s.createdon})`);

  const targets = sites.filter((s) => TARGET_IDS.includes(s.powerpagesiteid));
  if (targets.length === 0) {
    console.log(JSON.stringify({ deleted: 0, message: "none of the pinned duplicate site ids exist (already cleaned up?)" }));
    return;
  }

  const deleted = [];
  for (const s of targets) {
    console.error(`Deleting site ${s.powerpagesiteid} (created ${s.createdon}) ...`);
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
