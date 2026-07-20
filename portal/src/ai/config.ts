/* ============================================================
   Configuration for the AI intake assistant.

   Unlike the internal hub (a Power Apps code app whose CSP blocks
   all browser fetch), this Power Pages code site can call out
   directly: the SPA fetches the Azure Function proxy
   ("velops-customer-ai") with plain fetch(). The function key is
   inlined by Vite at build time (deploy-portal workflow) and
   appended as ?code= — a deliberate, documented v1 trade-off: the
   key is a revocable spend control, never a data credential (see
   docs/SECURITY.md and ai-proxy/README.md).
   ============================================================ */

/** Azure Function endpoint, e.g. https://velops-customer-ai.azurewebsites.net/api/messages */
export const AI_PROXY_URL: string = (import.meta.env.VITE_AI_PROXY_URL as string | undefined) ?? "";

/** Named, revocable function key ("portal") — appended as ?code=. */
export const AI_PROXY_KEY: string = (import.meta.env.VITE_AI_PROXY_KEY as string | undefined) ?? "";

/**
 * When unset the assistant page still renders (so the SPA builds and
 * deploys before the Function App exists) with a friendly notice.
 */
export const AI_PROXY_CONFIGURED: boolean = AI_PROXY_URL.length > 0;

/** Full request URL with the function key attached. */
export function proxyEndpoint(): string {
  if (!AI_PROXY_KEY) return AI_PROXY_URL;
  const sep = AI_PROXY_URL.includes("?") ? "&" : "?";
  return `${AI_PROXY_URL}${sep}code=${encodeURIComponent(AI_PROXY_KEY)}`;
}

/**
 * Write endpoint on the SAME Function App (…/api/portalwrite), reusing the same
 * 'portal' function key. Record creation that sets lookups runs here with the
 * admin SPN because the Power Pages portal Web API refuses portal-user
 * associations on this site (EntityPermissionAppendToIsMissingDuringAssociationChange).
 * Returns "" when the proxy isn't configured yet.
 */
export function portalWriteEndpoint(): string {
  if (!AI_PROXY_URL) return "";
  const url = AI_PROXY_URL.replace(/\/api\/messages\/?(\?.*)?$/, "/api/portalwrite$1");
  if (!AI_PROXY_KEY) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}code=${encodeURIComponent(AI_PROXY_KEY)}`;
}

/**
 * Model. Sonnet by default (cost cap — the function key ships in a
 * public bundle); flip USE_OPUS for demo-quality intake if needed.
 */
export const USE_OPUS = false;
export const MODEL: string = USE_OPUS ? "claude-opus-4-8" : "claude-sonnet-4-6";

/** Response budget for one assistant turn. */
export const MAX_TOKENS = 8000;

/** Hard cap on tool-use round trips per user turn. */
export const MAX_TOOL_ITERATIONS = 6;

/** Soft cap on user turns per session — then we suggest a fresh session. */
export const MAX_TURNS = 30;
