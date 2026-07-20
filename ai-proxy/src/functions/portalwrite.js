// VelOps CUSTOMER portal WRITE endpoint — Azure Function (Node v4).
//
// WHY THIS EXISTS: on this Power Pages site the portal Web API refuses EVERY
// portal-user association (setting any lookup on create) with
// EntityPermissionAppendToIsMissingDuringAssociationChange — proven exhaustively
// (Global/Self scope + Append To + web role all set, fresh UI permission, cache
// clear/restart: none work). Reads work; associated writes do not. So record
// creation that needs lookups is performed HERE with the admin service principal,
// which is not subject to portal table permissions.
//
// SECURITY: same posture as the Anthropic proxy (authLevel 'function' — the key
// is semi-public in the SPA bundle; treat as revocable, see docs/SECURITY.md).
// The endpoint NEVER trusts a client-supplied account: it derives the account
// from the contact's parentcustomerid, and refuses to post messages onto tickets
// outside the caller's team. Residual risk (a caller who knows another contact's
// GUID could file a ticket in that team's name — no data is readable this way) is
// the documented fast-follow: validate a Power Pages session token here.
//
// Actions (POST JSON { action, ... }):
//   createTicket  { contactId, subject, description, tickettype, priority, source?, appId? }
//   createMessage { contactId, ticketId, body }

const { app } = require('@azure/functions');
const { api, isGuid, cleanGuid } = require('../lib/dataverse');
const { HttpError, badRequest, corsHeaders, resolveContact, assertTicketInTeam } = require('../lib/portal');

const TICKET_SELECT =
  'gd_supportticketid,gd_ticketnumber,gd_name,gd_description,gd_tickettype,gd_priority,' +
  'gd_source,gd_resolutionsummary,gd_satisfactionrating,statecode,statuscode,createdon,modifiedon,' +
  '_gd_account_value,_gd_contact_value,_gd_app_value';
const MESSAGE_SELECT =
  'gd_supportmessageid,gd_name,gd_body,gd_direction,gd_authorname,createdon,_gd_ticket_value,_gd_authorcontact_value';

const DIRECTION_CUSTOMER = 122690000; // gd_messagedirection: Customer
const SOURCE_PORTAL_FORM = 122690000; // gd_ticketsource: Portal form
const ANNOTATE = { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' };

async function createTicket(input) {
  const me = await resolveContact(input.contactId);
  const subject = String(input.subject || '').trim();
  if (!subject) throw badRequest('A subject is required.');

  const body = {
    gd_name: subject,
    gd_description: String(input.description || ''),
    gd_tickettype: Number(input.tickettype),
    gd_priority: Number(input.priority),
    gd_source: Number.isFinite(Number(input.source)) ? Number(input.source) : SOURCE_PORTAL_FORM,
    'gd_Contact@odata.bind': `/contacts(${me.id})`,
    'gd_Account@odata.bind': `/accounts(${me.accountId})`,
  };

  // Only accept an app the caller's team actually has (gd_accountapp junction);
  // otherwise silently drop it rather than fail the whole ticket.
  if (input.appId && isGuid(input.appId)) {
    const appId = cleanGuid(input.appId);
    const link = await api(
      `gd_accountapps?$select=gd_accountappid&$filter=_gd_account_value eq ${me.accountId} and _gd_app_value eq ${appId}&$top=1`,
    );
    if (link.value && link.value.length > 0) body['gd_App@odata.bind'] = `/gd_apps(${appId})`;
  }

  const created = await api('gd_supporttickets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body,
  });
  // Re-read with formatted-value annotations so the SPA can show account/app names.
  const row = await api(`gd_supporttickets(${created.gd_supportticketid})?$select=${TICKET_SELECT}`, { headers: ANNOTATE });
  return row;
}

async function createMessage(input) {
  const me = await resolveContact(input.contactId);
  if (!isGuid(input.ticketId)) throw badRequest('Invalid or missing ticketId.');
  const ticketId = cleanGuid(input.ticketId);
  const body = String(input.body || '').trim();
  if (!body) throw badRequest('An empty message cannot be posted.');

  // Team-scope guard: the ticket must belong to the caller's own account.
  await assertTicketInTeam(ticketId, me.accountId);

  const title = body.length > 80 ? `${body.slice(0, 77)}...` : body;
  const created = await api('gd_supportmessages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      gd_name: title,
      gd_body: body,
      gd_direction: DIRECTION_CUSTOMER,
      gd_authorname: me.fullName,
      'gd_Ticket@odata.bind': `/gd_supporttickets(${ticketId})`,
      'gd_AuthorContact@odata.bind': `/contacts(${me.id})`,
    },
  });
  const row = await api(`gd_supportmessages(${created.gd_supportmessageid})?$select=${MESSAGE_SELECT}`, { headers: ANNOTATE });
  return row;
}

const ACTIONS = { createTicket, createMessage };

app.http('portalwrite', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  handler: async (request, context) => {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return { status: 204, headers: cors };

    const json = (status, obj) => ({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });

    let payload;
    try {
      payload = JSON.parse(await request.text());
    } catch {
      return json(400, { error: { message: 'Request body must be JSON.' } });
    }
    const action = ACTIONS[payload && payload.action];
    if (!action) return json(400, { error: { message: `Unknown action '${payload && payload.action}'.` } });

    try {
      const result = await action(payload);
      return json(200, { value: result });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: { message: err.message } });
      context.error('portalwrite failed', err);
      return json(502, { error: { message: 'The write could not be completed.', detail: String(err.message || err).slice(0, 500) } });
    }
  },
});
