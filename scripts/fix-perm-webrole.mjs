// Fix the runtime role link: the Power Pages runtime reads
// mspp_entitypermission_webrole, but configure-portal's link went into the
// powerpagecomponent self-N:N (reads back "linked" but the runtime ignores it),
// leaving mspp_entitypermission_webrole EMPTY -> "EntityPermissionReadIsMissing".
//
// This tries to populate mspp_entitypermission_webrole for every permission that
// still has 0 role rows, by RE-CREATING the permission with the web role bound at
// create time (deep insert) — the association survives create even when a
// post-hoc $ref does not. Parent-scoped perms are recreated after their parent so
// the mspp_parententitypermission reference is repointed to the new id. Verifies
// the nav row count went to >=1 (checkable with the SPN — no portal session needed).
// Idempotent: a permission that already has a role row is left untouched.
// Usage (CI): node scripts/fix-perm-webrole.mjs

import { api, fail, whoami, baseUrl, odataQuote } from "./lib/dataverse.mjs";

const NN = "mspp_entitypermission_webrole";

// Same 7 permissions as configure-portal, in dependency order (parent first).
const SCOPE = { GLOBAL: 756150000, CONTACT: 756150001, ACCOUNT: 756150002, PARENT: 756150003, SELF: 756150004 };
const DEFS = [
  { name: "Ticket - account scope", entity: "gd_supportticket", scope: SCOPE.ACCOUNT, accountrelationship: "gd_supportticket_Account_account", read: 1, write: 1, create: 1, append: 1, appendto: 1 },
  { name: "Message - parent via ticket", entity: "gd_supportmessage", scope: SCOPE.PARENT, parent: "Ticket - account scope", parentrelationship: "gd_supportmessage_Ticket_gd_supportticket", read: 1, create: 1, append: 1, appendto: 1 },
  { name: "Attachment - parent via ticket", entity: "gd_ticketattachment", scope: SCOPE.PARENT, parent: "Ticket - account scope", parentrelationship: "gd_ticketattachment_Ticket_gd_supportticket", read: 1, write: 1, create: 1, append: 1, appendto: 1 },
  { name: "Team apps - account scope", entity: "gd_accountapp", scope: SCOPE.ACCOUNT, accountrelationship: "gd_accountapp_Account_account", read: 1 },
  { name: "Apps - global", entity: "gd_app", scope: SCOPE.GLOBAL, read: 1 },
  { name: "Contact - self", entity: "contact", scope: SCOPE.SELF, read: 1, write: 1 },
  { name: "Account - own team", entity: "account", scope: SCOPE.ACCOUNT, read: 1 },
];

async function navCount(permId) {
  const r = await api(`mspp_entitypermissions(${permId})/${NN}?$select=mspp_webroleid`, { allow404: true })
    .catch(() => ({ value: [] }));
  return r?.value?.length ?? 0;
}

async function main() {
  await whoami();

  const { value: sites } = await api("mspp_websites?$select=mspp_websiteid,mspp_name");
  const result = {};

  for (const site of sites) {
    const siteId = site.mspp_websiteid;
    const role = (await api(
      `mspp_webroles?$select=mspp_webroleid,mspp_name&$filter=mspp_authenticatedusersrole eq true and _mspp_websiteid_value eq ${siteId}`,
    )).value[0];
    if (!role) { console.error(`! ${site.mspp_name}: no Authenticated Users role`); continue; }
    console.error(`\n=== ${site.mspp_name} — role '${role.mspp_name}' (${role.mspp_webroleid}) ===`);

    // Current permissions by entity name.
    const { value: existing } = await api(
      `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname,mspp_scope,mspp_read,mspp_write,mspp_create,mspp_append,mspp_appendto&$filter=_mspp_websiteid_value eq ${siteId}`,
    );
    const byEntity = new Map(existing.map((p) => [p.mspp_entityname, p]));
    const newIdByName = {}; // def.name -> new permission id (for parent repointing)

    for (const def of DEFS) {
      const cur = byEntity.get(def.entity);
      if (!cur) { console.error(`  ? ${def.entity}: not found, skipping`); continue; }

      const before = await navCount(cur.mspp_entitypermissionid);
      if (before > 0) {
        console.error(`  = ${def.entity}: already has ${before} role row(s) — leaving as-is`);
        newIdByName[def.name] = cur.mspp_entitypermissionid;
        result[`${def.entity}`] = { linked: true, recreated: false };
        continue;
      }

      // Recreate with the role bound at create time.
      const body = {
        mspp_entityname: def.entity,
        mspp_scope: def.scope,
        mspp_read: !!def.read,
        mspp_write: !!def.write,
        mspp_create: !!def.create,
        mspp_delete: false,
        mspp_append: !!def.append,
        mspp_appendto: !!def.appendto,
        "mspp_websiteid@odata.bind": `/mspp_websites(${siteId})`,
        [`${NN}@odata.bind`]: [`/mspp_webroles(${role.mspp_webroleid})`],
      };
      if (def.accountrelationship) body.mspp_accountrelationship = def.accountrelationship;
      if (def.parentrelationship) body.mspp_parentrelationship = def.parentrelationship;
      if (def.parent && newIdByName[def.parent]) {
        body["mspp_parententitypermission@odata.bind"] = `/mspp_entitypermissions(${newIdByName[def.parent]})`;
      }

      // Delete the old one first (children were already deleted earlier in the
      // loop order for parent-scoped defs; parents are recreated before children).
      await api(`mspp_entitypermissions(${cur.mspp_entitypermissionid})`, { method: "DELETE" }).catch((e) =>
        console.error(`    (delete warn: ${String(e.message || e).slice(0, 80)})`));

      let created;
      try {
        created = await api("mspp_entitypermissions", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body,
        });
      } catch (e) {
        console.error(`    deep-insert failed (${String(e.message || e).slice(0, 120)}) — recreating without role, then $ref`);
        const noRole = { ...body };
        delete noRole[`${NN}@odata.bind`];
        created = await api("mspp_entitypermissions", { method: "POST", headers: { Prefer: "return=representation" }, body: noRole });
        await api(`mspp_entitypermissions(${created.mspp_entitypermissionid})/${NN}/$ref`, {
          method: "POST",
          body: { "@odata.id": `${baseUrl()}/api/data/v9.2/mspp_webroles(${role.mspp_webroleid})` },
        }).catch((e2) => console.error(`    $ref also failed: ${String(e2.message || e2).slice(0, 100)}`));
      }
      const newId = created.mspp_entitypermissionid;
      newIdByName[def.name] = newId;
      const after = await navCount(newId);
      console.error(`  ${after > 0 ? "+" : "x"} ${def.entity}: recreated ${newId}, role rows now ${after}`);
      result[`${def.entity}`] = { linked: after > 0, recreated: true, newId };
    }
  }

  const allLinked = Object.values(result).every((r) => r.linked);
  console.log(JSON.stringify({ pass: allLinked, result }));
  if (!allLinked) process.exit(1);
}

main().catch(fail);
