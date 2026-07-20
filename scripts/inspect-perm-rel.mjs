// READ-ONLY: find the REAL relationship the Power Pages runtime uses to link a
// table permission to a web role, and check where our contact permission's link
// actually lives. The storage self-N:N (powerpagecomponent_powerpagecomponent)
// reads back "linked" but the runtime says EntityPermissionReadIsMissing, so the
// runtime must read a different intersect. This dumps every N:N on
// mspp_entitypermission (+ adx_entitypermission if present) and probes each for
// rows involving the contact permission.
// Usage (CI): node scripts/inspect-perm-rel.mjs

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

async function nnRels(logical) {
  const res = await api(
    `EntityDefinitions(LogicalName='${logical}')?$select=LogicalName&$expand=ManyToManyRelationships($select=SchemaName,IntersectEntityName,Entity1LogicalName,Entity2LogicalName,Entity1NavigationPropertyName,Entity2NavigationPropertyName)`,
    { allow404: true },
  ).catch((e) => ({ _err: String(e.message || e).slice(0, 120) }));
  return res;
}

async function main() {
  await whoami();

  // Resolve the contact permission id.
  const { value: perms } = await api(
    `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname&$filter=mspp_entityname eq ${odataQuote("contact")}`,
  );
  const contactPerm = perms[0];
  console.error(`contact permission id: ${contactPerm?.mspp_entitypermissionid}`);

  for (const logical of ["mspp_entitypermission", "adx_entitypermission"]) {
    console.error(`\n=== N:N relationships on ${logical} ===`);
    const def = await nnRels(logical);
    if (def._err) { console.error(`  (${def._err})`); continue; }
    const rels = def.ManyToManyRelationships || [];
    for (const r of rels) {
      console.error(`  - ${r.SchemaName}  intersect=${r.IntersectEntityName}  nav1=${r.Entity1NavigationPropertyName} nav2=${r.Entity2NavigationPropertyName}`);
    }
    // Probe each relationship nav from the contact permission (enhanced model
    // exposes mspp perms; the adx nav names may still resolve on the same row).
    if (contactPerm) {
      for (const r of rels) {
        for (const nav of [r.Entity1NavigationPropertyName, r.Entity2NavigationPropertyName]) {
          if (!nav) continue;
          const hit = await api(
            `mspp_entitypermissions(${contactPerm.mspp_entitypermissionid})/${nav}?$top=10`,
            { allow404: true },
          ).catch((e) => ({ _err: String(e.message || e).slice(0, 80) }));
          if (hit && hit.value) {
            console.error(`    nav ${nav}: ${hit.value.length} row(s)` +
              (hit.value.length ? ` -> ${JSON.stringify(hit.value.map((x) => x.mspp_webroleid || x.adx_webroleid || Object.values(x)[0]))}` : ""));
          } else if (hit && hit._err) {
            console.error(`    nav ${nav}: (err ${hit._err})`);
          }
        }
      }
    }
  }

  // Also list the intersect entity row counts directly, if queryable.
  for (const inter of ["mspp_entitypermission_webrole", "adx_entitypermission_webrole"]) {
    const rows = await api(`${inter}s?$top=5`, { allow404: true }).catch((e) => ({ _err: String(e.message || e).slice(0, 80) }));
    console.error(`\nintersect ${inter}: ${rows?.value ? rows.value.length + " row(s) (top 5)" : rows?._err || "n/a"}`);
  }

  console.log(JSON.stringify({ contactPermId: contactPerm?.mspp_entitypermissionid || null }));
}

main().catch(fail);
