/**
 * scripts/ensure-autonumber.mjs
 * Belt-and-braces: make sure gd_supportticket.gd_ticketnumber has AutoNumberFormat
 * 'VEL-{SEQNUM:5}' and that the sequence starts at 1001 (first ticket = VEL-01001).
 *
 * Hand-authored solution XML cannot reliably carry AutoNumberFormat through import,
 * so this script runs in CI right after import-solution (deploy-solution workflow).
 *
 * Usage:  node scripts/ensure-autonumber.mjs
 * Env:    DATAVERSE_URL, POWERPLATFORM_CLIENT_ID, POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID
 *
 * Idempotent:
 *  - format already correct  -> no metadata write, no publish
 *  - any gd_supportticket rows exist -> seed step is skipped (re-seeding a live
 *    sequence back to 1001 would hand out duplicate ticket numbers)
 *
 * API references:
 *  - Update attribute metadata: PUT EntityDefinitions(...)/Attributes(...) with the full
 *    retrieved definition + MSCRM.MergeLabels header
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/create-update-column-definitions-using-web-api
 *  - SetAutoNumberSeed (unbound action, body { EntityName, AttributeName, Value }):
 *    https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/setautonumberseed
 */

import { api, whoami, fail } from './lib/dataverse.mjs';

const ENTITY = 'gd_supportticket';
const ENTITY_SET = 'gd_supporttickets';
const ATTRIBUTE = 'gd_ticketnumber';
const FORMAT = 'VEL-{SEQNUM:5}';
const SEED = 1001;

const ATTRIBUTE_PATH = `EntityDefinitions(LogicalName='${ENTITY}')/Attributes(LogicalName='${ATTRIBUTE}')`;
const STRING_ATTRIBUTE_TYPE = 'Microsoft.Dynamics.CRM.StringAttributeMetadata';

async function readAttribute() {
  const attr = await api(`${ATTRIBUTE_PATH}/${STRING_ATTRIBUTE_TYPE}`, { allow404: true });
  if (!attr) {
    fail(
      `Attribute ${ENTITY}.${ATTRIBUTE} not found. Import the VelopsCustomers solution ` +
        '(deploy-solution workflow) before running ensure-autonumber.mjs.'
    );
  }
  return attr;
}

async function main() {
  await whoami();

  // --- 1. Ensure AutoNumberFormat -------------------------------------------------
  const before = await readAttribute();
  console.log(`Before: ${ENTITY}.${ATTRIBUTE} AutoNumberFormat = ${JSON.stringify(before.AutoNumberFormat ?? null)}`);

  if (before.AutoNumberFormat === FORMAT) {
    console.log(`AutoNumberFormat already '${FORMAT}' — no metadata update needed.`);
  } else {
    // Documented update pattern: retrieve the full attribute definition, modify it,
    // PUT it back with MSCRM.MergeLabels so existing labels are preserved.
    const updated = { ...before, '@odata.type': STRING_ATTRIBUTE_TYPE, AutoNumberFormat: FORMAT };
    delete updated['@odata.context'];

    console.log(`Updating AutoNumberFormat to '${FORMAT}' ...`);
    await api(ATTRIBUTE_PATH, {
      method: 'PUT',
      headers: { 'MSCRM.MergeLabels': 'true' },
      body: updated,
    });

    console.log(`Publishing ${ENTITY} ...`);
    await api('PublishXml', {
      method: 'POST',
      body: {
        ParameterXml: `<importexportxml><entities><entity>${ENTITY}</entity></entities></importexportxml>`,
      },
    });

    const after = await readAttribute();
    console.log(`After:  ${ENTITY}.${ATTRIBUTE} AutoNumberFormat = ${JSON.stringify(after.AutoNumberFormat ?? null)}`);
    if (after.AutoNumberFormat !== FORMAT) {
      fail(`AutoNumberFormat did not stick (still ${JSON.stringify(after.AutoNumberFormat)}).`);
    }
  }

  // --- 2. Ensure the seed (first ticket = VEL-01001) ------------------------------
  // Only seed while the table is still empty: SetAutoNumberSeed sets the NEXT number,
  // so re-seeding an in-use sequence would produce duplicate ticket numbers.
  const existing = await api(`${ENTITY_SET}?$select=${ENTITY}id&$top=1`);
  if (existing.value.length > 0) {
    console.log('gd_supportticket already contains rows — skipping SetAutoNumberSeed (sequence is live).');
  } else {
    console.log(`Table is empty — SetAutoNumberSeed(${ENTITY}.${ATTRIBUTE}) = ${SEED} ...`);
    await api('SetAutoNumberSeed', {
      method: 'POST',
      body: { EntityName: ENTITY, AttributeName: ATTRIBUTE, Value: SEED },
    });
    console.log(`Seed set to ${SEED} — first ticket will be VEL-0${SEED}.`);
  }

  console.log('ensure-autonumber: done.');
}

main().catch((err) => fail('ensure-autonumber.mjs failed.', err));
