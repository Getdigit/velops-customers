// Minimal Dataverse Web API client for the Function App (CommonJS, native fetch).
// Uses the SAME service-principal (client-credentials) as the CI ops scripts, but
// server-side only: the secret lives in the Function App settings, never the
// browser bundle. This exists because the Power Pages portal Web API refuses
// every portal-user association (AppendTo) on this site, so record creation that
// sets lookups is done here with the admin SPN instead of in the browser.
//
// Env (Function App settings): DATAVERSE_URL, POWERPLATFORM_CLIENT_ID,
// POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID.

const API_VERSION = 'v9.2';

function baseUrl() {
  const u = process.env.DATAVERSE_URL;
  if (!u) throw new Error('DATAVERSE_URL is not configured on the Function App.');
  return u.replace(/\/+$/, '');
}

let cachedToken = null;

async function getToken() {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.value;
  const tenantId = process.env.POWERPLATFORM_TENANT_ID;
  const clientId = process.env.POWERPLATFORM_CLIENT_ID;
  const clientSecret = process.env.POWERPLATFORM_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('POWERPLATFORM_CLIENT_ID / _SECRET / _TENANT_ID are not configured on the Function App.');
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: `${baseUrl()}/.default`,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Dataverse token request failed (HTTP ${res.status}): ${text.slice(0, 500)}`);
  const json = JSON.parse(text);
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (Number(json.expires_in) || 3000) * 1000 };
  return cachedToken.value;
}

/**
 * Call the Dataverse Web API. `path` is relative to /api/data/v9.2/.
 * Options: { method, headers, body (auto-JSON), allow404 }.
 * Returns parsed JSON (or null on 204/empty). Throws Error(.status) on failure.
 */
async function api(path, init = {}) {
  const token = await getToken();
  const url = `${baseUrl()}/api/data/${API_VERSION}/${String(path).replace(/^\/+/, '')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    ...(init.headers || {}),
  };
  let body = init.body;
  if (body !== undefined && typeof body !== 'string') body = JSON.stringify(body);
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  const res = await fetch(url, { method: init.method || 'GET', headers, body });
  if (res.ok) {
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  if (res.status === 404 && init.allow404) return null;
  const errText = await res.text().catch(() => '');
  const err = new Error(`Dataverse ${init.method || 'GET'} ${path} -> HTTP ${res.status}: ${errText.slice(0, 800)}`);
  err.status = res.status;
  throw err;
}

/**
 * Upload bytes into a Dataverse file column via a single PUT (octet-stream +
 * x-ms-file-name). `pathToColumn` is e.g. `gd_ticketattachments(<id>)/gd_file`.
 * Single-shot is fine for support photos (the column max is 32 MB; browsers
 * rarely send more). Throws Error(.status) on failure.
 */
async function uploadFileColumn(pathToColumn, fileName, bytes) {
  const token = await getToken();
  const url = `${baseUrl()}/api/data/${API_VERSION}/${String(pathToColumn).replace(/^\/+/, '')}?x-ms-file-name=${encodeURIComponent(fileName)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'x-ms-file-name': fileName,
    },
    body: bytes,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`file upload ${pathToColumn} -> HTTP ${res.status}: ${t.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
}

/** Quote + escape a string literal for an OData $filter (URL-encoded). */
function odataQuote(value) {
  return encodeURIComponent(`'${String(value).replace(/'/g, "''")}'`);
}

/** true iff `v` is a plain GUID (with or without braces/dashes tolerated). */
function isGuid(v) {
  return typeof v === 'string' && /^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/.test(v.trim());
}

function cleanGuid(v) {
  return String(v).trim().replace(/[{}]/g, '').toLowerCase();
}

module.exports = { api, baseUrl, getToken, odataQuote, isGuid, cleanGuid, uploadFileColumn };
