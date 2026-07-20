// Shared helpers for the portal write endpoints (portalwrite, portalupload):
// CORS, a typed HTTP error, and server-side contact/account resolution.

const { api, isGuid, cleanGuid } = require('./dataverse');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const badRequest = (m) => new HttpError(400, m);

function corsHeaders(origin) {
  const configured = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = {
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  if (configured.length && origin && configured.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  } else {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  return headers;
}

/**
 * Resolve + validate the caller's contact from the client-supplied id. Returns
 * { id, fullName, accountId }. The account is ALWAYS derived here (never trusted
 * from the client) so writes stay scoped to the caller's own team.
 */
async function resolveContact(contactId) {
  if (!isGuid(contactId)) throw badRequest('Invalid or missing contactId.');
  const id = cleanGuid(contactId);
  const c = await api(`contacts(${id})?$select=contactid,fullname,_parentcustomerid_value`, { allow404: true });
  if (!c) throw badRequest('Contact not found.');
  const accountId = c._parentcustomerid_value || null;
  if (!accountId) throw badRequest('Your account is not linked to a team yet.');
  return { id, fullName: c.fullname || '', accountId };
}

/** Assert a ticket belongs to the caller's team (else 403). */
async function assertTicketInTeam(ticketId, accountId) {
  const t = await api(`gd_supporttickets(${ticketId})?$select=gd_supportticketid,_gd_account_value`, { allow404: true });
  if (!t) throw badRequest('Ticket not found.');
  if ((t._gd_account_value || '').toLowerCase() !== accountId.toLowerCase()) {
    throw new HttpError(403, 'You cannot touch a ticket outside your team.');
  }
  return t;
}

module.exports = { HttpError, badRequest, corsHeaders, resolveContact, assertTicketInTeam };
