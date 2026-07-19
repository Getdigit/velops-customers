// READ-ONLY ops script: dump the raw powerpagecomponent content JSON of one
// entity-permission component and one web-role component, to learn how the
// enhanced data model encodes the permission<->webrole association (the
// Dataverse N:N $ref POST returns 204 but never persists — 2026-07-19).
// Usage (CI): node scripts/inspect-permission.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

// 'Ticket - account scope' on site 6bf16a72 + its Authenticated Users role.
const PERMISSION_ID = "00a893e3-7983-f111-8076-002248997172";
const WEBROLE_ID = "c73e73c3-f1d7-4940-a642-42d94c2627c6";

async function main() {
  await whoami();

  for (const [label, id] of [
    ["entitypermission", PERMISSION_ID],
    ["webrole", WEBROLE_ID],
  ]) {
    const c = await api(
      `powerpagecomponents(${id})?$select=powerpagecomponentid,name,powerpagecomponenttype,content`,
      { allow404: true },
    ).catch((e) => ({ error: String(e?.message || e) }));
    console.log(JSON.stringify({ label, component: c }, null, 2));
  }
}

main().catch(fail);
