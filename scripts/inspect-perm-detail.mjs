// READ-ONLY: dump the REAL stored state of the portal table permissions and
// their web-role links, to explain the runtime "EntityPermissionReadIsMissing"
// on the contact table even though configure-portal reported it linked.
// For each mspp_entitypermission: scope, read/write/create flags, website, and
// the web roles linked via the powerpagecomponent self-N:N (the storage-layer
// link) — cross-checked against the mspp_entitypermission_webrole facade.
// Usage (CI): node scripts/inspect-perm-detail.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

const NAV = "powerpagecomponent_powerpagecomponent";

async function main() {
  await whoami();

  const { value: sites } = await api("mspp_websites?$select=mspp_websiteid,mspp_name");
  for (const site of sites) {
    console.error(`\n=== website ${site.mspp_name} (${site.mspp_websiteid}) ===`);

    const { value: roles } = await api(
      `mspp_webroles?$select=mspp_webroleid,mspp_name,mspp_authenticatedusersrole&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    console.error("web roles:");
    for (const r of roles) {
      console.error(`  - ${r.mspp_name}  (${r.mspp_webroleid})  authUsersRole=${r.mspp_authenticatedusersrole}`);
    }
    const roleById = new Map(roles.map((r) => [r.mspp_webroleid, r]));

    const { value: perms } = await api(
      `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname,mspp_scope,` +
        `mspp_read,mspp_write,mspp_create,mspp_append,mspp_appendto,mspp_delete&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    console.error(`\nentity permissions: ${perms.length}`);
    for (const p of perms) {
      // Role links via the storage-layer self-N:N (ids map 1:1 mspp<->powerpagecomponent).
      let linkedRoleNames = [];
      try {
        const linked = await api(
          `powerpagecomponents(${p.mspp_entitypermissionid})/${NAV}?$select=powerpagecomponentid`,
        );
        linkedRoleNames = linked.value
          .map((c) => roleById.get(c.powerpagecomponentid)?.mspp_name || `(non-role ${c.powerpagecomponentid})`);
      } catch (e) {
        linkedRoleNames = [`(nav error: ${String(e.message || e).slice(0, 60)})`];
      }
      console.error(
        `  - ${p.mspp_entityname}  scope=${p.mspp_scope}  read=${p.mspp_read}  write=${p.mspp_write}  ` +
          `create=${p.mspp_create}  -> roles: [${linkedRoleNames.join(", ")}]`,
      );
    }
  }
  console.log(JSON.stringify({ done: true }));
}

main().catch(fail);
