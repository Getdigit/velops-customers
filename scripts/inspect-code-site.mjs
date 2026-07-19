// READ-ONLY round 2: pinpoint the dangling references that keep the live code
// site from serving the SPA. The 19:31 deploy-portal run failed exactly three
// component updates ("Does Not Exist") and both sites lack Home/Header/Footer
// web templates, so: dump the full mspp_website row (its header/footer template
// lookups are the prime dangling-ref suspects), page templates WITH ids, the
// page-template ids the webpages reference, the Home webpage copy, and hunt for
// pac's cross-run manifest (annotations + entity list).
// Usage (CI): node scripts/inspect-code-site.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

const FAILED_UPDATE_IDS = [
  "655ebc8a-1ec5-4970-857b-907aa3144726",
  "af5fb253-8636-474e-b27c-bfa6f3d0c4cc",
  "45436da8-05da-4408-9eb3-b279faeae540",
];

async function main() {
  await whoami();

  const { value: websites } = await api("mspp_websites?$select=mspp_websiteid,mspp_name");

  for (const site of websites) {
    console.error(`\n=== ${site.mspp_name} (${site.mspp_websiteid}) ===`);

    // Full website row: every scalar + lookup (_..._value) — shows which web
    // template ids the site header/footer point at.
    const full = await api(`mspp_websites(${site.mspp_websiteid})`);
    const interesting = Object.fromEntries(
      Object.entries(full).filter(
        ([k, v]) => v !== null && !k.startsWith("@") && (k.startsWith("_") || !/^mspp_websiteid$|^mspp_name$/.test(k)),
      ),
    );
    console.error(`website row (non-null fields): ${JSON.stringify(interesting, null, 1)}`);

    const { value: templates } = await api(
      `mspp_webtemplates?$select=mspp_webtemplateid,mspp_name&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    const templateIds = new Set(templates.map((t) => t.mspp_webtemplateid));

    const { value: pageTemplates } = await api(
      `mspp_pagetemplates?$select=mspp_pagetemplateid,mspp_name,mspp_type,_mspp_webtemplateid_value&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    console.error(`page templates: ${pageTemplates.length}`);
    for (const pt of pageTemplates) {
      const ref = pt._mspp_webtemplateid_value;
      const dangling = ref && !templateIds.has(ref) ? "  <-- DANGLING web template ref" : "";
      console.error(`  - ${pt.mspp_name}  (${pt.mspp_pagetemplateid})  type=${pt.mspp_type}  webtemplate=${ref}${dangling}`);
    }
    const pageTemplateIds = new Set(pageTemplates.map((pt) => pt.mspp_pagetemplateid));

    const { value: pages } = await api(
      `mspp_webpages?$select=mspp_webpageid,mspp_name,mspp_isroot,_mspp_pagetemplateid_value,mspp_copy&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}&$orderby=mspp_name asc`,
    );
    for (const p of pages) {
      const ref = p._mspp_pagetemplateid_value;
      const dangling = ref && !pageTemplateIds.has(ref) ? "  <-- DANGLING page template ref" : "";
      console.error(`  page ${p.mspp_name}  root=${p.mspp_isroot}  pagetemplate=${ref}${dangling}`);
      if (p.mspp_name === "Home" && p.mspp_copy) {
        console.error(`    Home copy: ${JSON.stringify(p.mspp_copy).slice(0, 700)}`);
      }
    }
  }

  console.error("\n=== the three failed-update ids: do they exist as any mspp_* record? ===");
  for (const id of FAILED_UPDATE_IDS) {
    const asComponent = await api(`powerpagecomponents(${id})?$select=powerpagecomponentid`, { allow404: true });
    console.error(`  ${id}: component=${asComponent ? "EXISTS" : "no"}`);
  }

  console.error("\n=== manifest hunt ===");
  const notes = await api(
    "annotations?$select=annotationid,subject,filename,objecttypecode&$filter=contains(subject,'manifest') or contains(filename,'manifest')",
  );
  console.error(`annotations mentioning 'manifest': ${JSON.stringify(notes.value)}`);

  const defs = await api("EntityDefinitions?$select=LogicalName");
  const hits = defs.value
    .map((d) => d.LogicalName)
    .filter((n) => /manifest|powerpage|mspp_sitecomponent/i.test(n));
  console.error(`entities matching /manifest|powerpage/: ${hits.join(", ")}`);

  console.log(JSON.stringify({ done: true }));
}

main().catch(fail);
