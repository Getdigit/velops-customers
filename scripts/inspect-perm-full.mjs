// READ-ONLY: compact dump of every mspp_entitypermission with the fields that
// actually decide runtime behaviour — scope, all CRUD/append flags, and the
// account/parent relationship columns. Used to confirm whether a UI change
// (e.g. account -> Global access) really landed on the row the runtime reads.
// Usage (CI): node scripts/inspect-perm-full.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

const SCOPE_NAME = {
  756150000: "Global",
  756150001: "Contact",
  756150002: "Account",
  756150003: "Parent",
  756150004: "Self",
};

async function main() {
  await whoami();
  const { value: sites } = await api("mspp_websites?$select=mspp_websiteid,mspp_name");
  for (const site of sites) {
    if (!site.mspp_name) continue;
    console.error(`\n=== ${site.mspp_name} (${site.mspp_websiteid}) ===`);
    const { value: perms } = await api(
      `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname,mspp_scope,` +
        `mspp_read,mspp_write,mspp_create,mspp_delete,mspp_append,mspp_appendto,` +
        `mspp_accountrelationship,mspp_parentrelationship` +
        `&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}&$orderby=mspp_entityname asc`,
    );
    for (const p of perms) {
      const flags = ["read", "write", "create", "delete", "append", "appendto"]
        .filter((f) => p[`mspp_${f}`])
        .join("+");
      console.error(
        `  ${p.mspp_entityname.padEnd(18)} scope=${SCOPE_NAME[p.mspp_scope] || p.mspp_scope}` +
          `  [${flags}]` +
          (p.mspp_accountrelationship ? `  acctRel=${p.mspp_accountrelationship}` : "") +
          (p.mspp_parentrelationship ? `  parentRel=${p.mspp_parentrelationship}` : ""),
      );
    }
  }
  console.log(JSON.stringify({ done: true }));
}

main().catch(fail);
