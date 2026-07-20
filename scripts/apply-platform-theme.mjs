// Idempotent: put the three platform-theme webfiles (bootstrap.min.css,
// portalbasictheme.css, theme.css from portal/platform-theme/) on the LIVE
// code site. The platform-hosted account/profile pages link these site
// webfiles; our bundleFilePatterns used to delete them at upload time, which
// left /Account/Login (and register/profile) completely unstyled. theme.css
// carries the VelOps overrides so those pages match the SPA's look.
//
// Creates the mspp_webfile rows if missing (parent = root Home page, like
// pac's own scaffold does — see microsoft/power-pages-samples), then PATCHes
// the powerpagecomponent filecontent with the css and verifies a readback.
// Usage (CI): node scripts/apply-platform-theme.mjs

import { readFileSync } from "node:fs";
import { api, fail, whoami, baseUrl, getToken, odataQuote } from "./lib/dataverse.mjs";

const SITE_ID = "5fece082-7a65-4d32-8996-8e7b23153bd3"; // live: velopssupport.powerappsportals.com
const FILES = ["bootstrap.min.css", "portalbasictheme.css", "theme.css"];

async function uploadFileContent(componentId, name, body) {
  // Raw fetch: lib api() JSON-handles bodies; file columns need octet-stream.
  const token = await getToken();
  const res = await fetch(`${baseUrl()}/api/data/v9.2/powerpagecomponents(${componentId})/filecontent`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "x-ms-file-name": name,
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`filecontent upload for ${name} failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
  }
}

async function main() {
  await whoami();

  const site = await api(`mspp_websites(${SITE_ID})?$select=mspp_name`);
  console.error(`Live site: ${site.mspp_name} (${SITE_ID})`);

  const { value: roots } = await api(
    `mspp_webpages?$select=mspp_webpageid&$filter=mspp_name eq ${odataQuote("Home")} and mspp_isroot eq true and _mspp_websiteid_value eq ${SITE_ID}`,
  );
  const rootHomeId = roots[0]?.mspp_webpageid;
  if (!rootHomeId) fail("root Home webpage not found");

  const { value: states } = await api(
    `mspp_publishingstates?$select=mspp_publishingstateid,mspp_name&$filter=_mspp_websiteid_value eq ${SITE_ID}`,
  );
  const published = states.find((s) => /published/i.test(s.mspp_name || "")) || states[0];
  if (!published) fail("no publishing state found");

  const results = {};
  let order = 1;
  for (const name of FILES) {
    const css = readFileSync(new URL(`../portal/platform-theme/${name}`, import.meta.url), "utf8");

    const { value: existing } = await api(
      `mspp_webfiles?$select=mspp_webfileid&$filter=mspp_name eq ${odataQuote(name)} and _mspp_websiteid_value eq ${SITE_ID}`,
    );
    let webfileId = existing[0]?.mspp_webfileid;
    if (webfileId) {
      console.error(`  ${name}: webfile row exists (${webfileId})`);
    } else {
      const created = await api("mspp_webfiles", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          mspp_name: name,
          mspp_partialurl: name,
          mspp_displayorder: order,
          mspp_excludefromsearch: true,
          mspp_hiddenfromsitemap: true,
          "mspp_websiteid@odata.bind": `/mspp_websites(${SITE_ID})`,
          "mspp_parentpageid@odata.bind": `/mspp_webpages(${rootHomeId})`,
          "mspp_publishingstateid@odata.bind": `/mspp_publishingstates(${published.mspp_publishingstateid})`,
        },
      });
      webfileId = created?.mspp_webfileid;
      console.error(`  ${name}: webfile row created (${webfileId})`);
    }
    order++;

    await uploadFileContent(webfileId, name, css);
    const readback = await api(`powerpagecomponents(${webfileId})/filecontent/$value`);
    const ok = typeof readback === "string" && readback.length === css.length;
    console.error(`  ${name}: content uploaded, readback ${String(readback).length}/${css.length} bytes -> ${ok ? "OK" : "MISMATCH"}`);
    results[name] = { webfileId, bytes: css.length, ok };
  }

  const allOk = Object.values(results).every((r) => r.ok);
  console.log(JSON.stringify({ pass: allOk, results }));
  if (!allOk) process.exit(1);
}

main().catch(fail);
