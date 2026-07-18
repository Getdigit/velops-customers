/**
 * scripts/seed-apps.mjs
 * Seed the 10 gd_app rows (VelOps product areas) used by the support portal's
 * "Product area" dropdown and the gd_accountapp junction table.
 *
 * Usage:  node scripts/seed-apps.mjs
 * Env:    DATAVERSE_URL, POWERPLATFORM_CLIENT_ID, POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID
 *
 * Idempotent: upsert-by-name — each app is looked up by gd_name first and only
 * created when missing. Existing rows are left untouched (descriptions may have
 * been edited by admins). Logs created/existing counts.
 */

import { api, whoami, fail, odataQuote } from './lib/dataverse.mjs';

const APPS = [
  { name: 'Rider App', description: 'Mobile app for riders: race program, calendar, travel and personal documents.' },
  { name: 'Team Hub', description: 'Central hub for staff: day-to-day team operations, planning and administration.' },
  { name: 'Mechanic Hub', description: 'Workshop hub for mechanics: bikes, equipment and race-day setup.' },
  { name: 'Truck App', description: 'App for truck drivers: logistics runs, loading lists and driving schedules.' },
  { name: 'Fleet', description: 'Vehicle fleet management: cars, trucks, campers, assignments and maintenance.' },
  { name: 'Planning & Calendar', description: 'Season planning, race calendar and staff scheduling.' },
  { name: 'Travel & Logistics', description: 'Travel booking, accommodation and race logistics coordination.' },
  { name: 'Reports & Data', description: 'Reporting, dashboards and data exports across the platform.' },
  { name: 'Account & Licensing', description: 'User accounts, licences, sign-in and access management.' },
  { name: 'Other', description: 'Anything that does not fit one of the other product areas.' },
];

async function main() {
  await whoami();

  let created = 0;
  let existing = 0;

  for (const app of APPS) {
    const query = await api(
      `gd_apps?$select=gd_appid,gd_name&$filter=gd_name eq ${odataQuote(app.name)}`
    );
    if (query.value.length > 0) {
      existing++;
      console.log(`= exists  ${app.name} (${query.value[0].gd_appid})`);
      continue;
    }
    const row = await api('gd_apps', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { gd_name: app.name, gd_description: app.description },
    });
    created++;
    console.log(`+ created ${app.name} (${row.gd_appid})`);
  }

  console.log(`seed-apps: done — ${created} created, ${existing} already existed, ${APPS.length} total.`);
}

main().catch((err) => fail('seed-apps.mjs failed.', err));
