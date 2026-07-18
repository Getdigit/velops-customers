/**
 * scripts/lib/dataverse.mjs
 * Zero-dependency Dataverse Web API client for the VelopsCustomers CI scripts.
 * Node 20+ ESM, native fetch only — no npm dependencies.
 *
 * Environment contract (set as GitHub Actions repo variables/secrets, see docs/RUNBOOK.md):
 *   DATAVERSE_URL                e.g. https://org.crm4.dynamics.com  (no trailing slash needed)
 *   POWERPLATFORM_CLIENT_ID     app registration (SPN) client id
 *   POWERPLATFORM_CLIENT_SECRET SPN client secret
 *   POWERPLATFORM_TENANT_ID     Entra tenant id
 *
 * Exports:
 *   fail(message, cause?)  — print a clear error and exit 1
 *   baseUrl()              — normalized DATAVERSE_URL
 *   getToken()             — client-credentials token (cached until near expiry)
 *   api(path, init?)       — fetch wrapper on <DATAVERSE_URL>/api/data/v9.2/ with OData
 *                            headers, JSON handling and ~3x retry on 429/5xx.
 *                            init.allow404: true -> return null instead of throwing on 404.
 *   whoami()               — GET WhoAmI; fails fast with a clear message on bad credentials.
 *   odataQuote(value)      — quote + escape a string literal for $filter expressions.
 */

const API_VERSION = 'v9.2';
const MAX_ATTEMPTS = 4; // 1 initial attempt + 3 retries
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Print a clear fatal message and exit 1. */
export function fail(message, cause) {
  console.error(`\nFATAL: ${message}`);
  if (cause) {
    console.error(cause instanceof Error ? cause.stack : String(cause));
  }
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    fail(
      `Missing required environment variable ${name}. ` +
        'Required: DATAVERSE_URL, POWERPLATFORM_CLIENT_ID, POWERPLATFORM_CLIENT_SECRET, POWERPLATFORM_TENANT_ID ' +
        '(see docs/RUNBOOK.md, one-time setup steps).'
    );
  }
  return value;
}

/** Normalized Dataverse org URL without trailing slash. */
export function baseUrl() {
  return requireEnv('DATAVERSE_URL').replace(/\/+$/, '');
}

/**
 * Quote, escape AND percent-encode a string literal for use inside an OData $filter
 * that is embedded in a request URL (handles embedded quotes and characters like '&').
 */
export function odataQuote(value) {
  return encodeURIComponent(`'${String(value).replace(/'/g, "''")}'`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let cachedToken = null;

/**
 * Acquire an access token via the client-credentials grant against
 * https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token with scope <DATAVERSE_URL>/.default.
 * Cached in-process until ~60s before expiry.
 */
export async function getToken() {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }
  const tenantId = requireEnv('POWERPLATFORM_TENANT_ID');
  const clientId = requireEnv('POWERPLATFORM_CLIENT_ID');
  const clientSecret = requireEnv('POWERPLATFORM_CLIENT_SECRET');
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  let response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: `${baseUrl()}/.default`,
      }),
    });
  } catch (err) {
    fail(`Could not reach the token endpoint ${tokenUrl}.`, err);
  }
  const text = await response.text();
  if (!response.ok) {
    fail(
      `Token request failed (HTTP ${response.status}). Check POWERPLATFORM_CLIENT_ID / ` +
        `POWERPLATFORM_CLIENT_SECRET / POWERPLATFORM_TENANT_ID.\n${text.slice(0, 1000)}`
    );
  }
  const json = JSON.parse(text);
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in) || 3000) * 1000,
  };
  return cachedToken.value;
}

/**
 * Call the Dataverse Web API.
 *   path  — relative to /api/data/v9.2/ (leading slash optional) or an absolute https URL.
 *   init  — { method, headers, body, allow404 }. Non-string bodies are JSON-stringified.
 * Returns parsed JSON (or null for empty/204 responses). Retries up to 3 times on
 * 429/5xx (honouring Retry-After) and on transient network errors. Throws Error
 * (with .status) on other failures; with allow404 a 404 returns null instead.
 */
export async function api(path, init = {}) {
  const token = await getToken();
  const url = /^https?:/i.test(path)
    ? path
    : `${baseUrl()}/api/data/${API_VERSION}/${String(path).replace(/^\/+/, '')}`;
  const method = init.method || 'GET';

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'OData-MaxVersion': '4.0',
    'OData-Version': '4.0',
    ...(init.headers || {}),
  };
  let body = init.body;
  if (body !== undefined && typeof body !== 'string') {
    body = JSON.stringify(body);
  }
  if (body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = 1000 * 2 ** (attempt - 1);
        console.error(`  network error on ${method} ${url} — retry in ${delayMs}ms: ${err.message}`);
        await sleep(delayMs);
        continue;
      }
      throw new Error(`Dataverse request failed after ${MAX_ATTEMPTS} attempts: ${method} ${url}`, {
        cause: lastError,
      });
    }

    if (response.ok) {
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }

    if (response.status === 404 && init.allow404) {
      return null;
    }

    if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const delayMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1);
      console.error(
        `  HTTP ${response.status} on ${method} ${url} — retry in ${delayMs}ms (attempt ${attempt}/${MAX_ATTEMPTS - 1})`
      );
      await sleep(delayMs);
      continue;
    }

    const errorText = await response.text().catch(() => '');
    const error = new Error(
      `Dataverse request failed: ${method} ${url} -> HTTP ${response.status} ${response.statusText}\n` +
        errorText.slice(0, 2000)
    );
    error.status = response.status;
    throw error;
  }
  throw lastError;
}

/**
 * GET WhoAmI — used by every script to fail fast on bad credentials or a wrong DATAVERSE_URL.
 * Logs the resolved user/org to stderr and returns { UserId, BusinessUnitId, OrganizationId }.
 */
export async function whoami() {
  try {
    const me = await api('WhoAmI');
    console.error(`Connected to ${baseUrl()} as UserId ${me.UserId} (org ${me.OrganizationId})`);
    return me;
  } catch (err) {
    fail(
      'WhoAmI failed. Check DATAVERSE_URL and the POWERPLATFORM_* credentials, and make sure the ' +
        'service principal is added as an application user with sufficient privileges in the ' +
        'target environment (docs/RUNBOOK.md, one-time setup).',
      err
    );
  }
}
