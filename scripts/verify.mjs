/**
 * scripts/verify.mjs
 * Read-back assertions against the live Dataverse environment. Prints exactly ONE
 * JSON report { pass, failures, summary } to STDOUT (all progress logs go to stderr)
 * and exits 1 on any failure — CI treats a red verify as a failed deploy.
 *
 * Usage:  node scripts/verify.mjs
 *         VERIFY_SCOPE=schema|data|portal|all   (default all) — which sections to run
 *         SMOKE=1                               — also create+delete a smoke gd_supportticket
 *                                                 and assert its ticket number is VEL-#####
 * Env:    DATAVERSE_URL, POWERPLATFORM_CLIENT_ID, POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID
 *
 * Sections:
 *   schema — 6 gd_ tables, gd_supportticket statuscodes, autonumber format, file column,
 *            gd_internalnote HasNotes, 4 global option sets (12269xxxx), role, app module
 *   data   — >=10 gd_app rows; optional smoke ticket (SMOKE=1)
 *   portal — mspp_website, the 7 table permissions linked to Authenticated Users, site
 *            settings, and the NEGATIVE assertions: zero permissions / Webapi settings
 *            for gd_internalnote or annotation (spec D1)
 */

import { api, whoami, fail, odataQuote } from './lib/dataverse.mjs';

const VERIFY_SCOPE = (process.env.VERIFY_SCOPE || 'all').toLowerCase();
if (!['schema', 'data', 'portal', 'all'].includes(VERIFY_SCOPE)) {
  fail(`Invalid VERIFY_SCOPE '${VERIFY_SCOPE}' — expected schema|data|portal|all.`);
}
const runSection = (name) => VERIFY_SCOPE === 'all' || VERIFY_SCOPE === name;

const failures = [];
let passed = 0;

function check(section, name, ok, detail) {
  if (ok) {
    passed++;
    console.error(`  PASS  ${name}`);
  } else {
    failures.push(`[${section}] ${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------------

const TABLES = [
  'gd_supportticket',
  'gd_supportmessage',
  'gd_internalnote',
  'gd_ticketattachment',
  'gd_app',
  'gd_accountapp',
];

const EXPECTED_STATUSCODES = [
  // [statuscode value, statecode]
  [1, 0], // New (default)
  [122690001, 0], // In Review
  [122690002, 0], // In Progress
  [122690003, 0], // In Development
  [122690004, 0], // Waiting on Customer
  [122690005, 0], // Resolved
  [2, 1], // Closed
];

const EXPECTED_OPTIONSETS = {
  gd_tickettype: { 122690000: 'Question', 122690001: 'Complaint', 122690002: 'Bug', 122690003: 'Feature request' },
  gd_ticketpriority: { 122690000: 'Low', 122690001: 'Medium', 122690002: 'High', 122690003: 'Critical' },
  gd_ticketsource: { 122690000: 'Portal form', 122690001: 'AI assistant' },
  gd_messagedirection: { 122690000: 'Customer', 122690001: 'VelOps' },
};

const AUTONUMBER_FORMAT = 'VEL-{SEQNUM:5}';

async function verifySchema() {
  console.error('\n== schema ==');

  for (const table of TABLES) {
    const def = await api(`EntityDefinitions(LogicalName='${table}')?$select=LogicalName,HasNotes`, {
      allow404: true,
    });
    check('schema', `table ${table} exists`, !!def);
    if (table === 'gd_internalnote' && def) {
      check('schema', 'gd_internalnote HasNotes = true', def.HasNotes === true, `HasNotes=${def.HasNotes}`);
    }
  }

  // statuscode option set on gd_supportticket
  const statusAttr = await api(
    `EntityDefinitions(LogicalName='gd_supportticket')/Attributes(LogicalName='statuscode')` +
      `/Microsoft.Dynamics.CRM.StatusAttributeMetadata?$expand=OptionSet`,
    { allow404: true }
  );
  if (statusAttr && statusAttr.OptionSet) {
    const byValue = new Map(statusAttr.OptionSet.Options.map((o) => [o.Value, o.State]));
    for (const [value, state] of EXPECTED_STATUSCODES) {
      check(
        'schema',
        `gd_supportticket statuscode ${value} (statecode ${state}) present`,
        byValue.get(value) === state,
        `got state ${byValue.has(value) ? byValue.get(value) : 'MISSING'}`
      );
    }
  } else {
    check('schema', 'gd_supportticket statuscode attribute readable', false);
  }

  // autonumber format
  const ticketNumber = await api(
    `EntityDefinitions(LogicalName='gd_supportticket')/Attributes(LogicalName='gd_ticketnumber')` +
      `/Microsoft.Dynamics.CRM.StringAttributeMetadata?$select=AutoNumberFormat`,
    { allow404: true }
  );
  check(
    'schema',
    `gd_ticketnumber AutoNumberFormat = '${AUTONUMBER_FORMAT}'`,
    ticketNumber?.AutoNumberFormat === AUTONUMBER_FORMAT,
    `got ${JSON.stringify(ticketNumber?.AutoNumberFormat ?? null)}`
  );

  // file column on gd_ticketattachment
  const fileAttr = await api(
    `EntityDefinitions(LogicalName='gd_ticketattachment')/Attributes(LogicalName='gd_file')` +
      `/Microsoft.Dynamics.CRM.FileAttributeMetadata?$select=MaxSizeInKB`,
    { allow404: true }
  );
  check(
    'schema',
    'gd_ticketattachment.gd_file exists with MaxSizeInKB 32768',
    fileAttr?.MaxSizeInKB === 32768,
    `got ${JSON.stringify(fileAttr?.MaxSizeInKB ?? null)}`
  );

  // global option sets
  for (const [name, expected] of Object.entries(EXPECTED_OPTIONSETS)) {
    const optionSet = await api(`GlobalOptionSetDefinitions(Name='${name}')`, { allow404: true });
    if (!optionSet || !Array.isArray(optionSet.Options)) {
      check('schema', `global option set ${name} exists`, false);
      continue;
    }
    check('schema', `global option set ${name} exists`, true);
    const labelByValue = new Map(
      optionSet.Options.map((o) => [o.Value, o.Label?.UserLocalizedLabel?.Label ?? null])
    );
    for (const [value, label] of Object.entries(expected)) {
      check(
        'schema',
        `${name} option ${value} = '${label}'`,
        labelByValue.get(Number(value)) === label,
        `got ${JSON.stringify(labelByValue.get(Number(value)) ?? 'MISSING')}`
      );
    }
    check(
      'schema',
      `${name} values all in 12269xxxx block`,
      optionSet.Options.every((o) => o.Value >= 122690000 && o.Value <= 122699999)
    );
  }

  // security role
  const roles = await api(`roles?$select=roleid&$filter=name eq ${odataQuote('VelOps Support')}`);
  check('schema', "role 'VelOps Support' exists", roles.value.length >= 1);

  // app module
  const appModules = await api(
    `appmodules?$select=appmoduleid&$filter=uniquename eq ${odataQuote('gd_VelopsSupportHub')}`
  );
  check('schema', 'app module gd_VelopsSupportHub exists', appModules.value.length >= 1);
}

// ---------------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------------

async function verifyData() {
  console.error('\n== data ==');

  const apps = await api('gd_apps?$select=gd_appid&$count=true', { allow404: true });
  const appCount = apps ? Number(apps['@odata.count'] ?? apps.value.length) : 0;
  check('data', '>= 10 gd_app rows seeded', appCount >= 10, `got ${appCount}`);

  if (process.env.SMOKE === '1') {
    console.error('  (SMOKE=1) creating smoke ticket ...');
    const created = await api('gd_supporttickets', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { gd_name: 'verify.mjs smoke ticket (safe to delete)' },
    });
    const ticketNumber = created.gd_ticketnumber;
    check(
      'data',
      'smoke ticket gd_ticketnumber matches ^VEL-\\d{5}$',
      /^VEL-\d{5}$/.test(ticketNumber || ''),
      `got ${JSON.stringify(ticketNumber ?? null)}`
    );
    await api(`gd_supporttickets(${created.gd_supportticketid})`, { method: 'DELETE' });
    console.error(`  smoke ticket ${ticketNumber} deleted again`);
  }
}

// ---------------------------------------------------------------------------------
// portal
// ---------------------------------------------------------------------------------

// Must stay in sync with scripts/configure-portal.mjs. mspp_entitypermission
// has NO separate friendly-name column (its primary name attribute IS
// mspp_entityname), so permissions are identified by entity logical name —
// unique per site in our config.
const EXPECTED_PERMISSIONS = [
  { label: 'Ticket - account scope', entity: 'gd_supportticket' },
  { label: 'Message - parent via ticket', entity: 'gd_supportmessage' },
  { label: 'Attachment - parent via ticket', entity: 'gd_ticketattachment' },
  { label: 'Team apps - account scope', entity: 'gd_accountapp' },
  { label: 'Apps - global', entity: 'gd_app' },
  { label: 'Contact - self', entity: 'contact' },
  { label: 'Account - own team', entity: 'account' },
];

const WEBAPI_TABLES = [
  'gd_supportticket',
  'gd_supportmessage',
  'gd_ticketattachment',
  'gd_accountapp',
  'gd_app',
  'contact',
];

function expectedSiteSettingNames() {
  const names = [];
  for (const table of WEBAPI_TABLES) {
    names.push(`Webapi/${table}/enabled`, `Webapi/${table}/fields`);
  }
  names.push(
    'Authentication/Registration/Enabled',
    'Authentication/Registration/OpenRegistrationEnabled',
    'Webapi/error/innererror'
  );
  return names;
}

// N:N navigation between mspp_entitypermission and mspp_webrole (see configure-portal.mjs).
// (the virtual mspp_entitypermission_webrole N:N is a non-persisting facade — links are read via powerpagecomponent_powerpagecomponent)

async function verifyPortal() {
  console.error('\n== portal ==');

  const sites = await api(
    'mspp_websites?$select=mspp_websiteid,mspp_name',
    { allow404: true }
  );
  const named = sites ? sites.value.filter((w) => w.mspp_name) : [];
  const websiteOk = named.length >= 1;
  check(
    'portal',
    'named mspp_website row exists (site created + activated)',
    websiteOk,
    sites ? `got ${sites.value.length} rows (${named.length} named)` : 'mspp_websites not found (enhanced data model missing)'
  );
  if (!websiteOk) return; // everything below needs a site

  // Activation state is not readable from Dataverse, so configure-portal covers
  // ALL named site rows — verify every one of them the same way. Stale duplicate
  // shells disappear once cleaned up (see RUNBOOK).
  for (const website of named) {
    const tag = named.length > 1 ? ` [${website.mspp_websiteid.slice(0, 8)}]` : '';
    console.error(`  verifying website '${website.mspp_name}' (${website.mspp_websiteid})`);

    const rolesResult = await api(
      `mspp_webroles?$select=mspp_webroleid,mspp_name` +
        `&$filter=mspp_authenticatedusersrole eq true and _mspp_websiteid_value eq ${website.mspp_websiteid}`
    );
    const authRole = rolesResult.value[0];
    check('portal', `built-in 'Authenticated Users' web role exists${tag}`, !!authRole);

    for (const { label: name, entity } of EXPECTED_PERMISSIONS) {
      const result = await api(
        `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname` +
          `&$filter=mspp_entityname eq ${odataQuote(entity)} and _mspp_websiteid_value eq ${website.mspp_websiteid}`
      );
      const permission = result.value[0];
      check('portal', `table permission '${name}' exists${tag}`, !!permission);
      if (permission && authRole) {
        // The virtual mspp_entitypermission_webrole N:N is a non-persisting
        // facade — the real link lives in the powerpagecomponent SELF N:N
        // (powerpagecomponent_powerpagecomponent), where mspp ids map 1:1 onto
        // component ids. Read it there (same layer configure-portal writes).
        const linkedResult = await api(
          `powerpagecomponents(${permission.mspp_entitypermissionid})/powerpagecomponent_powerpagecomponent?$select=powerpagecomponentid`
        );
        const linked = linkedResult.value.some((c) => c.powerpagecomponentid === authRole.mspp_webroleid);
        check('portal', `table permission '${name}' linked to Authenticated Users${tag}`, linked);
      }
    }

    for (const name of expectedSiteSettingNames()) {
      const result = await api(
        `mspp_sitesettings?$select=mspp_sitesettingid,mspp_value` +
          `&$filter=mspp_name eq ${odataQuote(name)} and _mspp_websiteid_value eq ${website.mspp_websiteid}`
      );
      check('portal', `site setting '${name}' present${tag}`, result.value.length >= 1);
    }
  }

  // NEGATIVE assertions (spec D1): internal notes and annotations must be hard-invisible.
  const forbiddenPermissions = await api(
    `mspp_entitypermissions?$select=mspp_entitypermissionid,mspp_entityname` +
      `&$filter=mspp_entityname eq ${odataQuote('gd_internalnote')} or mspp_entityname eq ${odataQuote('annotation')}`
  );
  check(
    'portal',
    'ZERO table permissions for gd_internalnote / annotation',
    forbiddenPermissions.value.length === 0,
    `found: ${forbiddenPermissions.value.map((p) => p.mspp_entityname).join(', ')}`
  );

  const forbiddenSettings = await api(
    `mspp_sitesettings?$select=mspp_sitesettingid,mspp_name` +
      `&$filter=startswith(mspp_name,${odataQuote('Webapi/gd_internalnote')}) or startswith(mspp_name,${odataQuote('Webapi/annotation')})`
  );
  check(
    'portal',
    'ZERO Webapi site settings for gd_internalnote / annotation',
    forbiddenSettings.value.length === 0,
    `found: ${forbiddenSettings.value.map((s) => s.mspp_name).join(', ')}`
  );
}

// ---------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------

async function main() {
  await whoami();

  if (runSection('schema')) await verifySchema();
  if (runSection('data')) await verifyData();
  if (runSection('portal')) await verifyPortal();

  const pass = failures.length === 0;
  const report = {
    pass,
    failures,
    summary: `${passed} checks passed, ${failures.length} failed (scope=${VERIFY_SCOPE})`,
  };
  // The single JSON report is the only thing written to stdout.
  console.log(JSON.stringify(report, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => fail('verify.mjs failed with an unexpected error.', err));
