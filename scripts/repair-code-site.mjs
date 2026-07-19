// One-off repair for the LIVE code site (5fece082, velopssupport.powerappsportals.com).
//
// Diagnosis (2026-07-19, see inspect-code-site.mjs runs): pac's cross-run manifest
// maps the Home content page and the Header/Footer web templates to component ids
// of the FIRST (long deleted) upload site, so every `pac pages upload-code-site`
// run "updates" those three records into the void ("Entity ... Does Not Exist")
// and no site ever gets them. A healthy code site (per Microsoft's
// power-pages-samples car-sales-website) serves the SPA like this:
//   - Home CONTENT page (isroot=false) whose mspp_copy IS the compiled index.html
//   - Header + Footer web templates containing just <div/> (blank the chrome)
//   - the mspp_website row's header/footer lookups pointing at those templates
// The live site has the website-row lookups (dangling) and the webfiles, but
// misses all three records — hence the empty default "Home" page.
//
// Repair: create the three records ON the live site, pinning the EXACT ids the
// site already references (header 89c87355, footer 7c2c45dd) plus pac's manifest
// id for the Home content page (45436da8), so existing references resolve and
// future pac uploads update these rows instead of failing.
// The Home copy is read from the site's own index.html webfile so the hashed
// asset references match the webfiles that are actually there.
// Usage (CI): node scripts/repair-code-site.mjs

import { api, fail, whoami, odataQuote } from "./lib/dataverse.mjs";

const SITE_ID = "5fece082-7a65-4d32-8996-8e7b23153bd3";
const HOME_CONTENT_PAGE_ID = "45436da8-05da-4408-9eb3-b279faeae540"; // pac manifest id (3rd failed update)

async function ensureWebTemplate(name, pinnedId, source) {
  const existing = await api(`mspp_webtemplates(${pinnedId})?$select=mspp_webtemplateid,mspp_name`, { allow404: true });
  if (existing) {
    console.error(`  web template '${name}' already exists at ${pinnedId} — leaving as-is`);
    return pinnedId;
  }
  const created = await api("mspp_webtemplates", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: {
      mspp_webtemplateid: pinnedId,
      mspp_name: name,
      mspp_source: source,
      "mspp_websiteid@odata.bind": `/mspp_websites(${SITE_ID})`,
    },
  });
  const actualId = created?.mspp_webtemplateid;
  console.error(`  web template '${name}': created, requested id ${pinnedId}, actual id ${actualId}`);
  if (actualId !== pinnedId) {
    console.error(`  WARNING: provider did not honor the pinned id for '${name}'!`);
  }
  return actualId;
}

async function main() {
  await whoami();

  const site = await api(`mspp_websites(${SITE_ID})`);
  const headerRef = site._mspp_headerwebtemplateid_value;
  const footerRef = site._mspp_footerwebtemplateid_value;
  console.error(`Live site '${site.mspp_name}' header->${headerRef} footer->${footerRef}`);
  if (!headerRef || !footerRef) fail("website row lacks header/footer web template lookups — unexpected, aborting.");

  // 1. Compiled index.html from the site's own webfile (asset hashes must match).
  const files = await api(
    `mspp_webfiles?$select=mspp_webfileid,mspp_name&$filter=mspp_name eq ${odataQuote("index.html")} and _mspp_websiteid_value eq ${SITE_ID}`,
  );
  const webfileId = files.value[0]?.mspp_webfileid;
  if (!webfileId) fail("index.html webfile not found on the live site — aborting.");

  let indexHtml = null;
  try {
    indexHtml = await api(`powerpagecomponents(${webfileId})/filecontent/$value`);
  } catch (err) {
    console.error(`  filecontent read failed (${err.status || err.message}) — trying annotations fallback`);
  }
  if (!indexHtml) {
    const notes = await api(
      `annotations?$select=annotationid,documentbody,mimetype&$filter=_objectid_value eq ${webfileId}&$orderby=modifiedon desc`,
      { allow404: true },
    );
    const body = notes?.value?.[0]?.documentbody;
    if (body) indexHtml = Buffer.from(body, "base64").toString("utf8");
  }
  if (!indexHtml || typeof indexHtml !== "string") fail("could not read index.html content — aborting.");
  const looksRight = /<div id="root">/.test(indexHtml) && /assets\/index-[^"']+\.js/.test(indexHtml);
  console.error(`index.html: ${indexHtml.length} bytes, SPA markers present: ${looksRight}`);
  if (!looksRight) fail(`index.html content does not look like the SPA shell: ${JSON.stringify(indexHtml.slice(0, 300))}`);

  // 2. Header/Footer web templates at the exact ids the website row references.
  console.error("Ensuring header/footer web templates ...");
  const headerId = await ensureWebTemplate("Header", headerRef, "<div/>");
  const footerId = await ensureWebTemplate("Footer", footerRef, "<div/>");

  // 3. Home content page (isroot=false) carrying the SPA shell as its copy.
  const existingContent = await api(
    `mspp_webpages(${HOME_CONTENT_PAGE_ID})?$select=mspp_webpageid,mspp_name`,
    { allow404: true },
  );
  let homeContentId = HOME_CONTENT_PAGE_ID;
  if (existingContent) {
    console.error(`  Home content page already exists at ${HOME_CONTENT_PAGE_ID} — updating copy`);
    await api(`mspp_webpages(${HOME_CONTENT_PAGE_ID})`, { method: "PATCH", body: { mspp_copy: indexHtml } });
  } else {
    const { value: roots } = await api(
      `mspp_webpages?$select=mspp_webpageid,_mspp_pagetemplateid_value&$filter=mspp_name eq ${odataQuote("Home")} and mspp_isroot eq true and _mspp_websiteid_value eq ${SITE_ID}`,
    );
    const rootHome = roots[0];
    if (!rootHome) fail("root Home webpage not found — aborting.");

    const { value: states } = await api(
      `mspp_publishingstates?$select=mspp_publishingstateid,mspp_name&$filter=_mspp_websiteid_value eq ${SITE_ID}`,
    );
    const published = states.find((s) => /published/i.test(s.mspp_name || "")) || states[0];
    if (!published) fail("no publishing state found for the site — aborting.");
    const languageId = site._mspp_defaultlanguage_value;
    if (!languageId) fail("site has no default language — aborting.");

    console.error(
      `  creating Home content page (root=${rootHome.mspp_webpageid}, template=${rootHome._mspp_pagetemplateid_value}, ` +
        `state='${published.mspp_name}', lang=${languageId})`,
    );
    const created = await api("mspp_webpages", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        mspp_webpageid: HOME_CONTENT_PAGE_ID,
        mspp_name: "Home",
        mspp_title: "Home",
        mspp_isroot: false,
        mspp_partialurl: "/",
        mspp_copy: indexHtml,
        "mspp_websiteid@odata.bind": `/mspp_websites(${SITE_ID})`,
        "mspp_rootwebpageid@odata.bind": `/mspp_webpages(${rootHome.mspp_webpageid})`,
        "mspp_pagetemplateid@odata.bind": `/mspp_pagetemplates(${rootHome._mspp_pagetemplateid_value})`,
        "mspp_publishingstateid@odata.bind": `/mspp_publishingstates(${published.mspp_publishingstateid})`,
        "mspp_webpagelanguageid@odata.bind": `/mspp_websitelanguages(${languageId})`,
      },
    });
    homeContentId = created?.mspp_webpageid;
    console.error(`  Home content page created, requested ${HOME_CONTENT_PAGE_ID}, actual ${homeContentId}`);
  }

  // 4. Verify everything resolves now.
  const verifyHeader = await api(`mspp_webtemplates(${headerRef})?$select=mspp_name`, { allow404: true });
  const verifyFooter = await api(`mspp_webtemplates(${footerRef})?$select=mspp_name`, { allow404: true });
  const verifyHome = await api(`mspp_webpages(${homeContentId})?$select=mspp_name,mspp_isroot`, { allow404: true });
  const result = {
    header_resolves: !!verifyHeader,
    footer_resolves: !!verifyFooter,
    home_content_page: !!verifyHome && verifyHome.mspp_isroot === false,
    header_id: headerId,
    footer_id: footerId,
    home_content_id: homeContentId,
  };
  console.log(JSON.stringify(result));
  if (!result.header_resolves || !result.footer_resolves || !result.home_content_page) process.exit(1);
}

main().catch(fail);
