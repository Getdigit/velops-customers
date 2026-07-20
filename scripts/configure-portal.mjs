/**
 * scripts/configure-portal.mjs
 * Configure the Power Pages site (ENHANCED data model — mspp_* rows in Dataverse):
 *   1. Resolve the mspp_website row (fails loud if the site was never created/activated).
 *   2. Resolve the built-in "Authenticated Users" web role.
 *   3. Upsert the 7 table permissions and associate each with that role.
 *   4. Upsert the site settings (Web API enablement, open registration, innererror).
 *
 * Usage:  node scripts/configure-portal.mjs
 * Env:    DATAVERSE_URL, POWERPLATFORM_CLIENT_ID, POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID
 *
 * Idempotent: permissions and settings are matched by name (+ website); existing rows
 * are PATCHed to the desired state, role associations are only added when missing.
 *
 * SECURITY INVARIANT (spec D1): gd_internalnote and annotation must NEVER get a table
 * permission or a Webapi site setting — internal notes are hard-invisible to the portal.
 * A guard below refuses to run if anyone ever adds them to the config tables, and
 * scripts/verify.mjs asserts the negative against the live environment.
 *
 * Schema references (enhanced data model — verified against Microsoft Learn):
 *  - mspp_entitypermission columns (mspp_entityname, mspp_scope, mspp_read/write/create/
 *    delete/append/appendto, mspp_accountrelationship, mspp_parentrelationship,
 *    mspp_parententitypermission, mspp_websiteid) and scope option values:
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_entitypermission
 *  - N:N to web roles: schema name mspp_entitypermission_webrole (NOT mspp_webrole_entitypermission):
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_entitypermission
 *  - mspp_webrole (mspp_authenticatedusersrole flag, mspp_websiteid):
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_webrole
 *  - mspp_sitesetting (mspp_name, mspp_value, mspp_websiteid):
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_sitesetting
 */

import { api, whoami, fail, odataQuote, baseUrl } from './lib/dataverse.mjs';

// mspp_entitypermission.mspp_scope option values ("Access Type").
// Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_entitypermission
const SCOPE = {
  GLOBAL: 756150000,
  CONTACT: 756150001,
  ACCOUNT: 756150002,
  PARENT: 756150003,
  SELF: 756150004,
};

// Many-to-many relationship / collection navigation property between table
// permissions and web roles in the enhanced data model.
// Source: https://learn.microsoft.com/en-us/power-apps/developer/data-platform/reference/entities/mspp_entitypermission
// (the virtual mspp_entitypermission_webrole N:N is a non-persisting facade — see ensureRoleAssociation)

// Entities that must NEVER be exposed to the portal (spec decision D1).
const FORBIDDEN_ENTITIES = new Set(['gd_internalnote', 'annotation']);

// The 7 table permissions. Order matters: 'Ticket - account scope' is created first
// because the two parent-scoped permissions reference it via mspp_parententitypermission.
// No permission grants Delete.
const PERMISSIONS = [
  {
    name: 'Ticket - account scope',
    entity: 'gd_supportticket',
    scope: SCOPE.ACCOUNT,
    accountrelationship: 'gd_supportticket_Account_account',
    read: true, write: true, create: true, append: true, appendto: true,
  },
  {
    name: 'Message - parent via ticket',
    entity: 'gd_supportmessage',
    scope: SCOPE.PARENT,
    parent: 'Ticket - account scope',
    parentrelationship: 'gd_supportmessage_Ticket_gd_supportticket',
    read: true, create: true, append: true, appendto: true,
  },
  {
    name: 'Attachment - parent via ticket',
    entity: 'gd_ticketattachment',
    scope: SCOPE.PARENT,
    parent: 'Ticket - account scope',
    parentrelationship: 'gd_ticketattachment_Ticket_gd_supportticket',
    // Write is required for the file-column upload (PUT octet-stream on gd_file).
    read: true, write: true, create: true, append: true, appendto: true,
  },
  {
    name: 'Team apps - account scope',
    entity: 'gd_accountapp',
    scope: SCOPE.ACCOUNT,
    accountrelationship: 'gd_accountapp_Account_account',
    read: true,
  },
  {
    name: 'Apps - global',
    entity: 'gd_app',
    scope: SCOPE.GLOBAL,
    read: true,
  },
  {
    name: 'Contact - self',
    entity: 'contact',
    scope: SCOPE.SELF,
    read: true, write: true,
  },
  {
    // Account scope on the account table itself grants access to the signed-in
    // contact's own parent account record (no relationship column needed).
    name: 'Account - own team',
    entity: 'account',
    scope: SCOPE.ACCOUNT,
    read: true,
  },
];

// Tables whose portal Web API is switched on. gd_internalnote and annotation are
// deliberately absent (spec D1) — the guard below enforces it.
const WEBAPI_TABLES = [
  'gd_supportticket',
  'gd_supportmessage',
  'gd_ticketattachment',
  'gd_accountapp',
  'gd_app',
  'contact',
];

function buildSiteSettings() {
  const settings = [];
  for (const table of WEBAPI_TABLES) {
    settings.push({ name: `Webapi/${table}/enabled`, value: 'true' });
    settings.push({ name: `Webapi/${table}/fields`, value: '*' });
  }
  settings.push({ name: 'Authentication/Registration/Enabled', value: 'true' });
  settings.push({ name: 'Authentication/Registration/OpenRegistrationEnabled', value: 'true' });
  // Customers sign in with LOCAL accounts only (for now): hide the whole
  // external-account column incl. the Microsoft Entra ID button. Two settings
  // as belt-and-braces — ExternalLoginEnabled kills the section, the AzureAD
  // one the specific provider. Flip both to 'true' to bring Entra back.
  settings.push({ name: 'Authentication/Registration/ExternalLoginEnabled', value: 'false' });
  settings.push({ name: 'Authentication/Registration/AzureADLoginEnabled', value: 'false' });
  // Verbose Web API errors during build-out; flipped to 'false' in the hardening phase.
  settings.push({ name: 'Webapi/error/innererror', value: 'true' });
  return settings;
}

function assertNoForbiddenExposure() {
  for (const p of PERMISSIONS) {
    if (FORBIDDEN_ENTITIES.has(p.entity)) {
      fail(`Config error: table permission '${p.name}' targets forbidden entity '${p.entity}' (spec D1).`);
    }
  }
  for (const t of WEBAPI_TABLES) {
    if (FORBIDDEN_ENTITIES.has(t)) {
      fail(`Config error: Webapi site settings requested for forbidden entity '${t}' (spec D1).`);
    }
  }
}

async function resolveWebsites() {
  const result = await api(
    'mspp_websites?$select=mspp_websiteid,mspp_name',
    { allow404: true }
  );
  if (!result || result.value.length === 0) {
    fail(
      'No mspp_website row found — the Power Pages site does not exist (or is not activated) yet.\n' +
        'Run the deploy-portal workflow first, then activate the site in the Power Pages home\n' +
        '(Inactive sites -> VelOps Support -> Activate). See docs/RUNBOOK.md, step 4.\n' +
        '(A 404 on mspp_websites means the enhanced-data-model tables are not provisioned at all.)'
    );
  }
  // Broken shells from failed uploads can have a null name — skip those, keep
  // every named site (see the note in main()).
  const named = result.value.filter((w) => w.mspp_name);
  if (named.length === 0) {
    fail('Only unnamed (broken) mspp_website rows found — re-run deploy-portal first.');
  }
  if (named.length > 1) {
    console.log(
      `WARNING: ${named.length} named mspp_website rows found — configuring ALL of them. ` +
        'Delete the stale duplicate sites when convenient (Power Pages home).'
    );
  }
  for (const w of named) console.log(`Website: '${w.mspp_name}' (${w.mspp_websiteid})`);
  return named;
}

async function resolveAuthenticatedUsersRole(websiteId) {
  const result = await api(
    `mspp_webroles?$select=mspp_webroleid,mspp_name` +
      `&$filter=mspp_authenticatedusersrole eq true and _mspp_websiteid_value eq ${websiteId}`
  );
  if (result.value.length === 0) {
    fail(
      'No web role with mspp_authenticatedusersrole = true found for the site. The built-in\n' +
        '"Authenticated Users" role is provisioned with the site — verify the site finished\n' +
        'activating (docs/RUNBOOK.md, step 4) and retry.'
    );
  }
  const role = result.value[0];
  console.log(`Web role: '${role.mspp_name}' (${role.mspp_webroleid})`);
  return role;
}

/** Upsert one table permission (match by name + website); returns its id. */
// mspp_entitypermission has NO separate friendly-name column: its primary name
// attribute IS mspp_entityname (observed 2026-07-19; a filter on mspp_name
// returns 'Could not find a property'). Permissions are therefore identified by
// entity logical name — unique per site in this configuration.
async function upsertPermission(def, website, permissionIdsByName) {
  const payload = {
    mspp_entityname: def.entity,
    mspp_scope: def.scope,
    mspp_read: !!def.read,
    mspp_write: !!def.write,
    mspp_create: !!def.create,
    mspp_delete: false, // never Delete — portal users cannot delete anything
    mspp_append: !!def.append,
    mspp_appendto: !!def.appendto,
    'mspp_websiteid@odata.bind': `/mspp_websites(${website.mspp_websiteid})`,
  };
  if (def.accountrelationship) payload.mspp_accountrelationship = def.accountrelationship;
  if (def.parentrelationship) payload.mspp_parentrelationship = def.parentrelationship;
  if (def.parent) {
    const parentId = permissionIdsByName.get(def.parent);
    if (!parentId) fail(`Config error: parent permission '${def.parent}' must be defined before '${def.name}'.`);
    payload['mspp_parententitypermission@odata.bind'] = `/mspp_entitypermissions(${parentId})`;
  }

  const existing = await api(
    `mspp_entitypermissions?$select=mspp_entitypermissionid` +
      `&$filter=mspp_entityname eq ${odataQuote(def.entity)} and _mspp_websiteid_value eq ${website.mspp_websiteid}`
  );

  let id;
  if (existing.value.length > 0) {
    // The mspp_ virtual-entity provider rejects PATCHes on existing permission
    // rows (HTTP 412 duplicate rule with identity fields, HTTP 400 'given key
    // was not present' without them — observed 2026-07-19). Creation is
    // authoritative: an existing row already carries the desired rights, so
    // leave it untouched. If the permission DEFINITION ever changes, delete the
    // row first and re-run this script.
    id = existing.value[0].mspp_entitypermissionid;
    console.log(`= permission exists   '${def.name}' (${id}) — left as-is`);
  } else {
    const created = await api('mspp_entitypermissions', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: payload,
    });
    id = created.mspp_entitypermissionid;
    console.log(`+ permission created  '${def.name}' (${id})`);
  }
  return id;
}

/** Associate a permission with the web role via the N:N (skip when already linked). */
async function ensureRoleAssociation(permissionId, permissionName, role) {
  // The virtual mspp_entitypermission_webrole N:N accepts $ref POSTs with 204
  // but never persists them (observed 2026-07-19). The enhanced data model
  // stores component-to-component links in the powerpagecomponent SELF N:N
  // (powerpagecomponent_powerpagecomponent) — mspp row ids map 1:1 onto
  // powerpagecomponent ids, so associate at that storage layer instead.
  const NAV = 'powerpagecomponent_powerpagecomponent';
  const linked = await api(
    `powerpagecomponents(${permissionId})/${NAV}?$select=powerpagecomponentid`
  );
  if (linked.value.some((c) => c.powerpagecomponentid === role.mspp_webroleid)) {
    console.log(`  = already linked to '${role.mspp_name}'`);
    return;
  }
  await api(`powerpagecomponents(${permissionId})/${NAV}/$ref`, {
    method: 'POST',
    body: { '@odata.id': `${baseUrl()}/api/data/v9.2/powerpagecomponents(${role.mspp_webroleid})` },
  });
  console.log(`  + linked '${permissionName}' to '${role.mspp_name}'`);
}

/** Upsert one site setting (match by name + website). */
async function upsertSiteSetting(setting, website) {
  const existing = await api(
    `mspp_sitesettings?$select=mspp_sitesettingid,mspp_value` +
      `&$filter=mspp_name eq ${odataQuote(setting.name)} and _mspp_websiteid_value eq ${website.mspp_websiteid}`
  );
  if (existing.value.length > 0) {
    const row = existing.value[0];
    if (row.mspp_value === setting.value) {
      console.log(`= setting unchanged  ${setting.name} = ${setting.value}`);
      return;
    }
    await api(`mspp_sitesettings(${row.mspp_sitesettingid})`, {
      method: 'PATCH',
      body: { mspp_value: setting.value },
    });
    console.log(`~ setting updated    ${setting.name} = ${setting.value} (was ${JSON.stringify(row.mspp_value)})`);
    return;
  }
  await api('mspp_sitesettings', {
    method: 'POST',
    body: {
      mspp_name: setting.name,
      mspp_value: setting.value,
      'mspp_websiteid@odata.bind': `/mspp_websites(${website.mspp_websiteid})`,
    },
  });
  console.log(`+ setting created    ${setting.name} = ${setting.value}`);
}

async function main() {
  assertNoForbiddenExposure();
  await whoami();

  // When stale duplicate site rows exist (failed uploads created one site per
  // run and the activation state is not readable from Dataverse — 2026-07-19:
  // mspp_primarydomainname stays null even on the activated site), configure
  // EVERY named site row. The activated one is then guaranteed to be covered;
  // stale shells receive harmless config and get deleted during cleanup.
  const websites = await resolveWebsites();

  for (const website of websites) {
    console.log(`\n=== Configuring '${website.mspp_name}' (${website.mspp_websiteid}) ===`);
    const role = await resolveAuthenticatedUsersRole(website.mspp_websiteid);

    console.log('--- Table permissions ---');
    const permissionIdsByName = new Map();
    for (const def of PERMISSIONS) {
      const id = await upsertPermission(def, website, permissionIdsByName);
      permissionIdsByName.set(def.name, id);
      await ensureRoleAssociation(id, def.name, role);
    }

    console.log('--- Site settings ---');
    for (const setting of buildSiteSettings()) {
      await upsertSiteSetting(setting, website);
    }
  }

  console.log('\nconfigure-portal: done. Run `node scripts/verify.mjs` (VERIFY_SCOPE=portal) to assert.');
}

main().catch((err) => fail('configure-portal.mjs failed.', err));
