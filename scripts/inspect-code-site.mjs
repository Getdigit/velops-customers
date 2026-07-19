// READ-ONLY: dump the component inventory of the remaining "VelOps Support"
// code site so we can see whether the SPA (Home/Header/Footer web templates +
// webfiles) is actually bound to the LIVE site, or whether pac's manifest still
// points at components of the deleted duplicate sites.
//
// Prints per mspp_webtemplate: name, modifiedon, and whether its source contains
// the SPA markers (<div id="root"> / assets/index-*.js). Also lists webpages and
// webfiles with modifiedon, plus any raw powerpagecomponents whose ids match the
// three "Does Not Exist" update failures from the 19:31 deploy-portal run.
// Usage (CI): node scripts/inspect-code-site.mjs

import { api, fail, whoami } from "./lib/dataverse.mjs";

const FAILED_UPDATE_IDS = [
  "655ebc8a-1ec5-4970-857b-907aa3144726",
  "af5fb253-8636-474e-b27c-bfa6f3d0c4cc",
  "45436da8-05da-4408-9eb3-b279faeae540",
];

const spaMarkers = (source) => ({
  root: /<div id="root">/.test(source || ""),
  bundle: /assets\/index-[^"']+\.js/.test(source || ""),
  length: (source || "").length,
});

async function main() {
  await whoami();

  const { value: storageSites } = await api(
    "powerpagesites?$select=powerpagesiteid,name,createdon&$orderby=createdon asc",
  );
  console.error(`powerpagesite rows: ${storageSites.length}`);
  for (const s of storageSites) {
    console.error(`  - ${s.name}  (${s.powerpagesiteid}, created ${s.createdon})`);
  }

  const { value: websites } = await api(
    "mspp_websites?$select=mspp_websiteid,mspp_name",
  );
  console.error(`Named mspp_website rows: ${websites.length}`);

  for (const site of websites) {
    console.error(`\n=== ${site.mspp_name} (${site.mspp_websiteid}) ===`);

    const { value: templates } = await api(
      `mspp_webtemplates?$select=mspp_webtemplateid,mspp_name,mspp_source&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    console.error(`web templates: ${templates.length}`);
    for (const t of templates) {
      const m = spaMarkers(t.mspp_source);
      console.error(
        `  - ${t.mspp_name}  (${t.mspp_webtemplateid})  len=${m.length}  root=${m.root}  bundle=${m.bundle}`,
      );
    }

    const { value: pageTemplates } = await api(
      `mspp_pagetemplates?$select=mspp_pagetemplateid,mspp_name,mspp_type,_mspp_webtemplateid_value&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}`,
    );
    const templateIds = new Set(templates.map((t) => t.mspp_webtemplateid));
    console.error(`page templates: ${pageTemplates.length}`);
    for (const pt of pageTemplates) {
      const ref = pt._mspp_webtemplateid_value;
      const dangling = ref && !templateIds.has(ref) ? "  <-- DANGLING web template ref" : "";
      console.error(`  - ${pt.mspp_name}  type=${pt.mspp_type}  webtemplate=${ref}${dangling}`);
    }

    const { value: pages } = await api(
      `mspp_webpages?$select=mspp_webpageid,mspp_name,mspp_isroot,_mspp_pagetemplateid_value,mspp_copy&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}&$orderby=mspp_name asc`,
    );
    console.error(`webpages: ${pages.length}`);
    for (const p of pages) {
      const m = spaMarkers(p.mspp_copy);
      console.error(
        `  - ${p.mspp_name}  root=${p.mspp_isroot}  pagetemplate=${p._mspp_pagetemplateid_value}  copyLen=${m.length}  copyRoot=${m.root}  copyBundle=${m.bundle}`,
      );
    }

    const { value: files } = await api(
      `mspp_webfiles?$select=mspp_webfileid,mspp_name&$filter=_mspp_websiteid_value eq ${site.mspp_websiteid}&$orderby=mspp_name asc`,
    );
    console.error(`webfiles: ${files.length}`);
    for (const f of files) {
      console.error(`  - ${f.mspp_name}`);
    }
  }

  // Where does pac keep the cross-run manifest that still maps the Home/Header/
  // Footer templates to ids of the first (deleted) site? Look for candidate
  // entities and any component rows named like a manifest.
  console.error("\n=== manifest hunt ===");
  const defs = await api(
    "EntityDefinitions?$select=LogicalName&$filter=contains(LogicalName,'manifest')",
  );
  console.error(`entities with 'manifest' in the name: ${defs.value.map((d) => d.LogicalName).join(", ") || "(none)"}`);

  console.error("\n=== the three failed-update component ids ===");
  for (const id of FAILED_UPDATE_IDS) {
    const row = await api(
      `powerpagecomponents(${id})?$select=powerpagecomponentid,name,_powerpagesiteid_value`,
      { allow404: true },
    );
    console.error(`  ${id}: ${row ? `EXISTS name=${row.name} site=${row._powerpagesiteid_value}` : "does not exist"}`);
  }

  console.log(JSON.stringify({ done: true, websites: websites.map((w) => w.mspp_name) }));
}

main().catch(fail);
