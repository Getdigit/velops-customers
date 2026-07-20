/* ============================================================
   PortalProvider — thin OData wrapper over the Power Pages
   Web API (/_api). Reads use $select/$filter/$expand/$orderby;
   mutations carry the __RequestVerificationToken CSRF header
   (shell.getTokenDeferred() when available, /_layout/tokenhtml
   as fallback).

   File upload follows the Dataverse / Power Pages file-column
   contract (learn.microsoft.com: file-column-data + Power Pages
   file-column): <=16MB in one PUT (octet-stream, x-ms-file-name),
   larger files in 4MB blocks after an initial request with
   x-ms-transfer-mode: chunked, each block carrying Content-Range.

   NOTE: Web API single-valued navigation properties for custom
   lookups use the attribute SchemaName (gd_Ticket, gd_Account,
   gd_App, gd_Contact, gd_Message, gd_AuthorContact).
   ============================================================ */
import type {
  Attachment,
  Message,
  NewTicketInput,
  PortalUser,
  Profile,
  TeamApp,
  TeamMember,
  Ticket,
} from "../types";
import { DIRECTION, SOURCE } from "../types";
import { portalUploadEndpoint, portalWriteEndpoint } from "../ai/config";
import type { DataProvider } from "./provider";
import { readPortalUser } from "./user";

const API = "/_api";
const ANNOTATIONS = 'odata.include-annotations="*"';

type ODataRecord = Record<string, unknown>;

interface TokenShell {
  shell?: { getTokenDeferred?: () => { done(cb: (t: string) => void): { fail(cb: (e: unknown) => void): void } } };
}

function formatted(row: ODataRecord, field: string): string | null {
  const v = row[`${field}@OData.Community.Display.V1.FormattedValue`];
  return typeof v === "string" ? v : null;
}

function str(row: ODataRecord, field: string): string {
  const v = row[field];
  return typeof v === "string" ? v : "";
}

function strOrNull(row: ODataRecord, field: string): string | null {
  const v = row[field];
  return typeof v === "string" && v !== "" ? v : null;
}

function num(row: ODataRecord, field: string, fallback = 0): number {
  const v = row[field];
  return typeof v === "number" ? v : fallback;
}

function numOrNull(row: ODataRecord, field: string): number | null {
  const v = row[field];
  return typeof v === "number" ? v : null;
}

/** Escape a string literal for an OData filter. */
function odataQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export class PortalProvider implements DataProvider {
  private profileCache: Profile | null = null;

  /* ---------------- token + fetch plumbing ---------------- */

  private async getToken(): Promise<string> {
    const w = window as unknown as TokenShell;
    if (w.shell?.getTokenDeferred) {
      try {
        return await new Promise<string>((resolve, reject) => {
          w.shell!.getTokenDeferred!().done(resolve).fail(reject);
        });
      } catch {
        /* fall through to tokenhtml */
      }
    }
    const res = await fetch("/_layout/tokenhtml", { credentials: "same-origin" });
    const html = await res.text();
    const m = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/);
    if (!m) throw new Error("Could not obtain a request verification token.");
    return m[1]!;
  }

  private async get<T = ODataRecord>(pathAndQuery: string): Promise<T> {
    const res = await fetch(`${API}/${pathAndQuery}`, {
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        Prefer: ANNOTATIONS,
      },
    });
    if (!res.ok) throw new Error(`GET ${pathAndQuery} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  private async getList(pathAndQuery: string): Promise<ODataRecord[]> {
    const data = await this.get<{ value?: ODataRecord[] }>(pathAndQuery);
    return data.value ?? [];
  }

  // NOTE: record CREATION (ticket/message/attachment) no longer goes through the
  // portal Web API — it binds lookups, which this site refuses for portal users
  // (see portalWrite/uploadAttachment). Only scalar PATCH (status/rating/profile)
  // still runs here, since updates need no association privilege.
  private async patch(entitySet: string, id: string, body: ODataRecord): Promise<void> {
    const token = await this.getToken();
    const res = await fetch(`${API}/${entitySet}(${id})`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        __RequestVerificationToken: token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${entitySet}(${id}) failed: ${res.status} ${await res.text()}`);
  }

  /* ---------------- identity + profile ---------------- */

  currentUser(): Promise<PortalUser | null> {
    return Promise.resolve(readPortalUser());
  }

  async myProfile(): Promise<Profile> {
    if (this.profileCache) return this.profileCache;
    const user = readPortalUser();
    if (!user) throw new Error("Not signed in.");
    const row = await this.get<ODataRecord>(
      `contacts(${user.contactId})?$select=contactid,firstname,lastname,fullname,emailaddress1,telephone1,jobtitle,_parentcustomerid_value`,
    );
    const profile: Profile = {
      contactId: str(row, "contactid") || user.contactId,
      firstName: str(row, "firstname"),
      lastName: str(row, "lastname"),
      fullName: str(row, "fullname"),
      email: strOrNull(row, "emailaddress1"),
      phone: strOrNull(row, "telephone1"),
      jobTitle: strOrNull(row, "jobtitle"),
      accountId: strOrNull(row, "_parentcustomerid_value"),
      accountName: formatted(row, "_parentcustomerid_value"),
    };
    this.profileCache = profile;
    return profile;
  }

  async updateProfile(patch: Partial<Profile>): Promise<void> {
    const me = await this.myProfile();
    const body: ODataRecord = {};
    if (patch.firstName !== undefined) body.firstname = patch.firstName;
    if (patch.lastName !== undefined) body.lastname = patch.lastName;
    if (patch.phone !== undefined) body.telephone1 = patch.phone;
    if (patch.jobTitle !== undefined) body.jobtitle = patch.jobTitle;
    if (Object.keys(body).length === 0) return;
    await this.patch("contacts", me.contactId, body);
    this.profileCache = null;
  }

  /* ---------------- team ---------------- */

  async teamApps(): Promise<TeamApp[]> {
    const me = await this.myProfile();
    if (!me.accountId) return [];
    const rows = await this.getList(
      `gd_accountapps?$select=gd_accountappid,gd_name&$filter=_gd_account_value eq ${me.accountId}` +
        `&$expand=gd_App($select=gd_appid,gd_name,gd_description)&$orderby=gd_name asc`,
    );
    return rows
      .map((row) => {
        const app = (row.gd_App ?? null) as ODataRecord | null;
        return {
          id: str(row, "gd_accountappid"),
          appId: app ? str(app, "gd_appid") : "",
          name: app ? str(app, "gd_name") : str(row, "gd_name"),
          description: app ? strOrNull(app, "gd_description") : null,
        };
      })
      .filter((a) => a.appId !== "")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async teamMembers(): Promise<TeamMember[]> {
    const me = await this.myProfile();
    if (!me.accountId) return [];
    const rows = await this.getList(
      `contacts?$select=contactid,fullname,emailaddress1&$filter=_parentcustomerid_value eq ${me.accountId}&$orderby=fullname asc`,
    );
    return rows.map((row) => ({
      contactId: str(row, "contactid"),
      fullName: str(row, "fullname"),
      email: strOrNull(row, "emailaddress1"),
    }));
  }

  /* ---------------- tickets ---------------- */

  private static readonly TICKET_SELECT =
    "$select=gd_supportticketid,gd_ticketnumber,gd_name,gd_description,gd_tickettype,gd_priority," +
    "gd_source,gd_resolutionsummary,gd_satisfactionrating,statecode,statuscode,createdon,modifiedon," +
    "_gd_account_value,_gd_contact_value,_gd_app_value";

  private mapTicket(row: ODataRecord): Ticket {
    return {
      id: str(row, "gd_supportticketid"),
      ticketNumber: str(row, "gd_ticketnumber"),
      subject: str(row, "gd_name"),
      description: str(row, "gd_description"),
      tickettype: num(row, "gd_tickettype"),
      priority: num(row, "gd_priority"),
      source: num(row, "gd_source", SOURCE.PORTAL_FORM),
      statecode: num(row, "statecode"),
      statuscode: num(row, "statuscode"),
      accountId: strOrNull(row, "_gd_account_value"),
      accountName: formatted(row, "_gd_account_value"),
      contactId: strOrNull(row, "_gd_contact_value"),
      contactName: formatted(row, "_gd_contact_value"),
      appId: strOrNull(row, "_gd_app_value"),
      appName: formatted(row, "_gd_app_value"),
      resolutionSummary: strOrNull(row, "gd_resolutionsummary"),
      satisfactionRating: numOrNull(row, "gd_satisfactionrating"),
      createdOn: str(row, "createdon"),
      modifiedOn: str(row, "modifiedon"),
    };
  }

  async listTickets(): Promise<Ticket[]> {
    const rows = await this.getList(
      `gd_supporttickets?${PortalProvider.TICKET_SELECT}&$orderby=modifiedon desc`,
    );
    return rows.map((r) => this.mapTicket(r));
  }

  async getTicket(id: string): Promise<Ticket> {
    const row = await this.get<ODataRecord>(`gd_supporttickets(${id})?${PortalProvider.TICKET_SELECT}`);
    return this.mapTicket(row);
  }

  async searchMyTickets(q: string): Promise<Ticket[]> {
    const needle = q.trim();
    if (!needle) return this.listTickets();
    const quoted = odataQuote(needle);
    const rows = await this.getList(
      `gd_supporttickets?${PortalProvider.TICKET_SELECT}` +
        `&$filter=(contains(gd_name,${quoted}) or contains(gd_ticketnumber,${quoted}))` +
        `&$orderby=modifiedon desc`,
    );
    return rows.map((r) => this.mapTicket(r));
  }

  /**
   * Portal WRITE via the Azure Function (…/api/portalwrite), NOT the Power Pages
   * Web API. Record creation that sets lookups (gd_Contact/gd_Account/gd_App on a
   * ticket, gd_Ticket/gd_AuthorContact on a message) is refused for portal users
   * on this site — every association fails with
   * EntityPermissionAppendToIsMissingDuringAssociationChange regardless of table
   * permissions. The function performs the create with the admin SPN and derives
   * the account server-side from the contact, so team-wide scope is preserved.
   * Reads still go through the portal Web API (getTicket/listTickets), unchanged.
   */
  private async portalWrite(action: string, payload: Record<string, unknown>): Promise<ODataRecord> {
    const endpoint = portalWriteEndpoint();
    if (!endpoint) {
      throw new Error("The write service isn't configured yet — the VelOps team is finishing setup.");
    }
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const json = (await res.json().catch(() => ({}))) as { value?: ODataRecord; error?: { message?: string } };
    if (!res.ok) throw new Error(json?.error?.message || `Write failed (HTTP ${res.status}).`);
    if (!json.value) throw new Error("The write service returned an empty result.");
    return json.value;
  }

  async createTicket(input: NewTicketInput): Promise<Ticket> {
    const me = await this.myProfile();
    if (!me.accountId) throw new Error("Your account is not linked to a team yet.");
    const row = await this.portalWrite("createTicket", {
      contactId: me.contactId,
      subject: input.subject,
      description: input.description,
      tickettype: input.tickettype,
      priority: input.priority,
      source: input.source ?? SOURCE.PORTAL_FORM,
      appId: input.appId ?? null,
    });
    return this.mapTicket(row);
  }

  async setStatus(ticketId: string, statuscode: number, statecode: number): Promise<void> {
    await this.patch("gd_supporttickets", ticketId, { statecode, statuscode });
  }

  async rate(ticketId: string, rating: number): Promise<void> {
    await this.patch("gd_supporttickets", ticketId, { gd_satisfactionrating: rating });
  }

  /* ---------------- messages ---------------- */

  private mapMessage(row: ODataRecord): Message {
    return {
      id: str(row, "gd_supportmessageid"),
      ticketId: strOrNull(row, "_gd_ticket_value") ?? "",
      title: str(row, "gd_name"),
      body: str(row, "gd_body"),
      direction: num(row, "gd_direction", DIRECTION.CUSTOMER),
      authorName: str(row, "gd_authorname"),
      authorContactId: strOrNull(row, "_gd_authorcontact_value"),
      createdOn: str(row, "createdon"),
    };
  }

  async listMessages(ticketId: string): Promise<Message[]> {
    const rows = await this.getList(
      `gd_supportmessages?$select=gd_supportmessageid,gd_name,gd_body,gd_direction,gd_authorname,createdon,` +
        `_gd_ticket_value,_gd_authorcontact_value&$filter=_gd_ticket_value eq ${ticketId}&$orderby=createdon asc`,
    );
    return rows.map((r) => this.mapMessage(r));
  }

  async createMessage(ticketId: string, body: string): Promise<Message> {
    const me = await this.myProfile();
    // Server-side write (binds gd_Ticket + gd_AuthorContact) — see portalWrite.
    const row = await this.portalWrite("createMessage", {
      contactId: me.contactId,
      ticketId,
      body,
    });
    return this.mapMessage(row);
  }

  /* ---------------- attachments ---------------- */

  private mapAttachment(row: ODataRecord): Attachment {
    return {
      id: str(row, "gd_ticketattachmentid"),
      ticketId: strOrNull(row, "_gd_ticket_value") ?? "",
      messageId: strOrNull(row, "_gd_message_value"),
      fileName: str(row, "gd_name"),
      mimeType: str(row, "gd_mimetype"),
      isImage: row.gd_isimage === true,
      createdOn: str(row, "createdon"),
    };
  }

  async listAttachments(ticketId: string): Promise<Attachment[]> {
    const rows = await this.getList(
      `gd_ticketattachments?$select=gd_ticketattachmentid,gd_name,gd_mimetype,gd_isimage,createdon,` +
        `_gd_ticket_value,_gd_message_value&$filter=_gd_ticket_value eq ${ticketId}&$orderby=createdon asc`,
    );
    return rows.map((r) => this.mapAttachment(r));
  }

  attachmentUrl(a: Attachment): string {
    return `${API}/gd_ticketattachments(${a.id})/gd_file/$value`;
  }

  /**
   * Server-side attachment upload (see portalWrite): the gd_ticketattachment
   * create binds gd_Ticket/gd_Message, which the portal Web API refuses, so the
   * record AND the file column are written by the /api/portalupload Function with
   * the admin SPN. The raw file is the request body; metadata rides in the query.
   */
  async uploadAttachment(ticketId: string, file: File, messageId?: string): Promise<Attachment> {
    const me = await this.myProfile();
    const endpoint = portalUploadEndpoint();
    if (!endpoint) throw new Error("The upload service isn't configured yet — the VelOps team is finishing setup.");
    const params = new URLSearchParams({
      contactId: me.contactId,
      ticketId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
    });
    if (messageId) params.set("messageId", messageId);
    const sep = endpoint.includes("?") ? "&" : "?";
    const res = await fetch(`${endpoint}${sep}${params.toString()}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    const json = (await res.json().catch(() => ({}))) as { value?: ODataRecord; error?: { message?: string } };
    if (!res.ok) throw new Error(json?.error?.message || `Upload failed (HTTP ${res.status}).`);
    if (!json.value) throw new Error("The upload service returned an empty result.");
    return this.mapAttachment(json.value);
  }
}
