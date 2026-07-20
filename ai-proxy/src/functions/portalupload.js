// VelOps CUSTOMER portal ATTACHMENT upload — Azure Function (Node v4).
//
// Companion to portalwrite: creating a gd_ticketattachment binds gd_Ticket
// (+ gd_Message), which the Power Pages portal Web API refuses for portal users
// on this site (EntityPermissionAppendToIsMissingDuringAssociationChange). So the
// record AND the file column are written here with the admin SPN.
//
// Request: POST octet-stream body = the raw file bytes; metadata in the query
// string: contactId, ticketId, fileName, mimeType, and optional messageId.
// authLevel 'function' — same 'portal' key as messages/portalwrite.

const { app } = require('@azure/functions');
const { api, isGuid, cleanGuid, uploadFileColumn } = require('../lib/dataverse');
const { HttpError, badRequest, corsHeaders, resolveContact, assertTicketInTeam } = require('../lib/portal');

const ATTACH_SELECT =
  'gd_ticketattachmentid,gd_name,gd_mimetype,gd_isimage,createdon,_gd_ticket_value,_gd_message_value';
const MAX_BYTES = 32 * 1024 * 1024; // gd_file column max (32 MB)

app.http('portalupload', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'function',
  handler: async (request, context) => {
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(origin);
    if (request.method === 'OPTIONS') return { status: 204, headers: cors };
    const json = (status, obj) => ({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(obj) });

    try {
      const q = request.query;
      const me = await resolveContact(q.get('contactId'));
      if (!isGuid(q.get('ticketId'))) throw badRequest('Invalid or missing ticketId.');
      const ticketId = cleanGuid(q.get('ticketId'));
      await assertTicketInTeam(ticketId, me.accountId);

      const fileName = (q.get('fileName') || 'attachment').slice(0, 200);
      const mimeType = q.get('mimeType') || 'application/octet-stream';
      const messageId = isGuid(q.get('messageId')) ? cleanGuid(q.get('messageId')) : null;

      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length === 0) throw badRequest('Empty file.');
      if (bytes.length > MAX_BYTES) throw badRequest('File is larger than the 32 MB limit.');

      const record = {
        gd_name: fileName,
        gd_mimetype: mimeType,
        gd_isimage: mimeType.startsWith('image/'),
        'gd_Ticket@odata.bind': `/gd_supporttickets(${ticketId})`,
      };
      if (messageId) record['gd_Message@odata.bind'] = `/gd_supportmessages(${messageId})`;

      const created = await api('gd_ticketattachments', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: record,
      });
      const id = created.gd_ticketattachmentid;
      await uploadFileColumn(`gd_ticketattachments(${id})/gd_file`, fileName, bytes);

      const row = await api(`gd_ticketattachments(${id})?$select=${ATTACH_SELECT}`);
      return json(200, { value: row });
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: { message: err.message } });
      context.error('portalupload failed', err);
      return json(502, { error: { message: 'The upload could not be completed.', detail: String(err.message || err).slice(0, 500) } });
    }
  },
});
