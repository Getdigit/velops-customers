// READ-ONLY: dump the raw powerpagecomponent storage for the contact table
// permission and the Authenticated Users web role. The enhanced model stores
// config as JSON in powerpagecomponent.content with a powerpagecomponenttype
// discriminator; the runtime role link (mspp_entitypermission_webrole, which the
// Web API can't populate) may actually live inside one of these content blobs.
// If so we can PATCH it. This shows the structure.
// Usage (CI): node scripts/inspect-ppc.mjs

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

async function dump(label, id) {
  const row = await api(
    `powerpagecomponents(${id})?$select=powerpagecomponentid,name,powerpagecomponenttype,_powerpagecomponenttype_value,content,_powerpagesiteid_value`,
    { allow404: true },
  ).catch((e) => ({ _err: String(e.message || e).slice(0, 120) }));
  console.error(`\n=== ${label} (${id}) ===`);
  if (!row || row._err) { console.error(`  ${row?._err || "not found"}`); return null; }
  console.error(`  name: ${row.name}`);
  console.error(`  type: ${row.powerpagecomponenttype ?? row._powerpagecomponenttype_value}`);
  console.error(`  content: ${row.content ? String(row.content) : "(empty)"}`);
  return row;
}

async function main() {
  await whoami();

  const contactPerm = (await api(
    `mspp_entitypermissions?$select=mspp_entitypermissionid&$filter=mspp_entityname eq ${odataQuote("contact")}`,
  )).value[0];
  const authRole = (await api(
    `mspp_webroles?$select=mspp_webroleid&$filter=mspp_authenticatedusersrole eq true`,
  )).value[0];
  const ticketPerm = (await api(
    `mspp_entitypermissions?$select=mspp_entitypermissionid&$filter=mspp_entityname eq ${odataQuote("gd_supportticket")}`,
  )).value[0];

  console.error(`contact perm: ${contactPerm?.mspp_entitypermissionid}`);
  console.error(`auth role:    ${authRole?.mspp_webroleid}`);

  await dump("contact entity permission — ppc", contactPerm.mspp_entitypermissionid);
  await dump("gd_supportticket entity permission — ppc", ticketPerm.mspp_entitypermissionid);
  await dump("Authenticated Users web role — ppc", authRole.mspp_webroleid);

  // Look for a distinct component TYPE that represents the permission<->role
  // association (an intersect-like component). List component types present on
  // the site and their counts.
  const { value: comps } = await api(
    `powerpagecomponents?$select=powerpagecomponentid,name,_powerpagecomponenttype_value&$top=500`,
  );
  const byType = {};
  for (const c of comps) {
    const t = c._powerpagecomponenttype_value ?? "?";
    byType[t] = (byType[t] || 0) + 1;
  }
  console.error(`\n=== powerpagecomponent type histogram (top 500) ===`);
  for (const [t, n] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.error(`  type ${t}: ${n}`);
  }

  console.log(JSON.stringify({ done: true }));
}

main().catch(fail);
