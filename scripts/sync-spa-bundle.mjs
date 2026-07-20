// Build the SPA and push the fresh bundle STRAIGHT onto the LIVE code site's
// webfiles + Home content page — bypassing `pac pages upload-code-site`, which
// in this environment never matches the existing site and always creates a new
// duplicate (RUNBOOK geleerde les 2). This script is THE way to ship a new
// bundle (also after RUNBOOK stap ⑤ sets the AI-proxy vars: run-script.yml
// passes VITE_AI_PROXY_URL/KEY through to the build).
//
// Steps: npm ci + vite build in portal/ -> upsert a webfile per dist file
// (parent = root Home page for root files, or the assets/fonts root webpage) ->
// delete live hashed bundle files no longer in dist -> refresh the Home content
// page copy (the SPA shell, see repair-code-site.mjs) -> verify readbacks.
// Usage (CI): node scripts/sync-spa-bundle.mjs
// Env: DATAVERSE_URL + POWERPLATFORM_* (SPN), optional VITE_AI_PROXY_URL/KEY.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { api, fail, whoami, baseUrl, getToken, odataQuote } from "./lib/dataverse.mjs";

const SITE_ID = "5fece082-7a65-4d32-8996-8e7b23153bd3"; // live: velopssupport.powerappsportals.com
const HOME_CONTENT_PAGE_ID = "45436da8-05da-4408-9eb3-b279faeae540";
const PORTAL_DIR = new URL("../portal", import.meta.url).pathname;
const HASHED_BUNDLE_RE = /-[A-Za-z0-9_-]{8}\.(js|css)$/; // vite content-hash pattern
const TEXT_EXT_RE = /\.(html|js|css|json|txt)$/i;
// Dataverse blocks these attachment types (0x80043e09) — same family as the .js
// block we cleared once. We NEVER ship them as webfiles: uploading one aborts the
// whole sync and leaves the Home page pointing at the previous bundle. Anything
// the UI needs (e.g. the logo) is inlined as a data URI in the platform theme.
const BLOCKED_UPLOAD_RE = /\.(svg|htm)$/i;

function buildSpa() {
  console.error("Building SPA (npm ci + vite build) ...");
  execFileSync("npm", ["ci"], { cwd: PORTAL_DIR, stdio: ["ignore", 2, 2] });
  execFileSync("npm", ["run", "build"], { cwd: PORTAL_DIR, stdio: ["ignore", 2, 2] });
}

function listDist() {
  const distDir = join(PORTAL_DIR, "dist");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(distDir);
  return files.map((p) => {
    const rel = relative(distDir, p).replaceAll("\\", "/");
    const parts = rel.split("/");
    if (parts.length > 2) fail(`dist file nested deeper than one folder: ${rel} — extend the parent-page mapping first`);
    return { rel, name: parts.at(-1), dir: parts.length === 2 ? parts[0] : "", body: readFileSync(p) };
  });
}

async function uploadFileContent(componentId, name, body) {
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
  if (!res.ok) throw new Error(`filecontent upload for ${name}: HTTP ${res.status} ${await res.text().catch(() => "")}`);
}

async function main() {
  buildSpa();
  const allDist = listDist();
  const blocked = allDist.filter((f) => BLOCKED_UPLOAD_RE.test(f.name));
  const dist = allDist.filter((f) => !BLOCKED_UPLOAD_RE.test(f.name));
  if (blocked.length) {
    console.error(`skipping ${blocked.length} Dataverse-blocked file(s): ${blocked.map((f) => f.rel).join(", ")}`);
  }
  console.error(`dist: ${dist.length} files (of ${allDist.length})`);

  await whoami();

  // Parent pages: '' -> root Home page, 'assets'/'fonts' -> that folder's root webpage.
  const parentIds = {};
  for (const [dir, pageName] of [["", "Home"], ["assets", "assets"], ["fonts", "fonts"]]) {
    const { value } = await api(
      `mspp_webpages?$select=mspp_webpageid&$filter=mspp_name eq ${odataQuote(pageName)} and mspp_isroot eq true and _mspp_websiteid_value eq ${SITE_ID}`,
    );
    if (!value[0]) fail(`root webpage '${pageName}' not found on the live site`);
    parentIds[dir] = value[0].mspp_webpageid;
  }
  const { value: states } = await api(
    `mspp_publishingstates?$select=mspp_publishingstateid,mspp_name&$filter=_mspp_websiteid_value eq ${SITE_ID}`,
  );
  const published = states.find((s) => /published/i.test(s.mspp_name || "")) || states[0];

  const { value: liveFiles } = await api(
    `mspp_webfiles?$select=mspp_webfileid,mspp_name&$filter=_mspp_websiteid_value eq ${SITE_ID}`,
  );
  const liveByName = new Map(liveFiles.map((f) => [f.mspp_name, f.mspp_webfileid]));

  // 1. Upsert every dist file.
  let created = 0, updated = 0;
  for (const f of dist) {
    let webfileId = liveByName.get(f.name);
    if (!webfileId) {
      const row = await api("mspp_webfiles", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: {
          mspp_name: f.name,
          mspp_partialurl: f.name,
          mspp_excludefromsearch: true,
          mspp_hiddenfromsitemap: true,
          "mspp_websiteid@odata.bind": `/mspp_websites(${SITE_ID})`,
          "mspp_parentpageid@odata.bind": `/mspp_webpages(${parentIds[f.dir]})`,
          "mspp_publishingstateid@odata.bind": `/mspp_publishingstates(${published.mspp_publishingstateid})`,
        },
      });
      webfileId = row?.mspp_webfileid;
      created++;
      console.error(`  + ${f.rel} (new webfile ${webfileId})`);
    } else {
      updated++;
    }
    await uploadFileContent(webfileId, f.name, f.body);
  }
  console.error(`upserted content for ${dist.length} files (${created} new rows, ${updated} existing)`);

  // 2. Remove stale hashed bundles (never touches theme/font/image files).
  const distNames = new Set(dist.map((f) => f.name));
  let deleted = 0;
  for (const [name, id] of liveByName) {
    if (HASHED_BUNDLE_RE.test(name) && !distNames.has(name)) {
      await api(`powerpagecomponents(${id})`, { method: "DELETE" });
      deleted++;
      console.error(`  - ${name} (stale hashed bundle)`);
    }
  }

  // 3. Home content page copy = fresh index.html (PATCH on the virtual row may
  // be rejected — fall back to delete + re-create at the same pinned id).
  const indexHtml = dist.find((f) => f.rel === "index.html").body.toString("utf8");
  try {
    await api(`mspp_webpages(${HOME_CONTENT_PAGE_ID})`, { method: "PATCH", body: { mspp_copy: indexHtml } });
    console.error("Home content page copy PATCHed");
  } catch (err) {
    console.error(`PATCH of Home content page failed (${err.status || err.message}) — recreating at the pinned id`);
    await api(`mspp_webpages(${HOME_CONTENT_PAGE_ID})`, { method: "DELETE" });
    await api("mspp_webpages", {
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
        "mspp_rootwebpageid@odata.bind": `/mspp_webpages(${parentIds[""]})`,
        "mspp_pagetemplateid@odata.bind": `/mspp_pagetemplates(5a1a79ab-a1c3-4d5d-bedb-041f4e2d07db)`,
        "mspp_publishingstateid@odata.bind": `/mspp_publishingstates(${published.mspp_publishingstateid})`,
        "mspp_webpagelanguageid@odata.bind": `/mspp_websitelanguages(9932df2d-f734-4222-8bfe-4606db0c5610)`,
      },
    });
    console.error("Home content page recreated");
  }

  // 4. Verify text readbacks (binary files skip the byte-compare).
  const failures = [];
  for (const f of dist.filter((x) => TEXT_EXT_RE.test(x.name))) {
    const id = (await api(
      `mspp_webfiles?$select=mspp_webfileid&$filter=mspp_name eq ${odataQuote(f.name)} and _mspp_websiteid_value eq ${SITE_ID}`,
    )).value[0]?.mspp_webfileid;
    const readback = await api(`powerpagecomponents(${id})/filecontent/$value`);
    if (String(readback) !== f.body.toString("utf8")) failures.push(f.rel);
  }
  const { value: homeCheck } = await api(
    `mspp_webpages?$select=mspp_copy&$filter=mspp_webpageid eq ${HOME_CONTENT_PAGE_ID}`,
  );
  const homeOk = homeCheck[0]?.mspp_copy === indexHtml;
  if (!homeOk) failures.push("Home content page copy");

  console.log(JSON.stringify({ pass: failures.length === 0, files: dist.length, created, deleted, failures }));
  if (failures.length > 0) process.exit(1);
}

main().catch(fail);
