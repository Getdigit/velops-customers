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
import type { DataProvider } from "./provider";
import { readPortalUser } from "./user";

const API = "/_api";
const ANNOTATIONS = 'odata.include-annotations="*"';
const SINGLE_UPLOAD_LIMIT = 16 * 1024 * 1024; // 16 MB
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB blocks

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

  /** POST a record; returns the new record's id (from OData-EntityId). */
  private async post(entitySet: string, body: ODataRecord): Promise<string> {
    const token = await this.getToken();
    const res = await fetch(`${API}/${entitySet}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        __RequestVerificationToken: token,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${entitySet} failed: ${res.status} ${await res.text()}`);
    const entityId = res.headers.get("OData-EntityId") ?? res.headers.get("odata-entityid") ?? "";
    const m = entityId.match(/\(([0-9a-fA-F-]{36})\)/);
    if (!m) throw new Error(`POST ${entitySet}: no OData-EntityId returned.`);
    return m[1]!.toLowerCase();
  }

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

  async createTicket(input: NewTicketInput): Promise<Ticket> {
    const me = await this.myProfile();
    if (!me.accountId) throw new Error("Your account is not linked to a team yet.");
    const body: ODataRecord = {
      gd_name: input.subject,
      gd_description: input.description,
      gd_tickettype: input.tickettype,
      gd_priority: input.priority,
      gd_source: input.source ?? SOURCE.PORTAL_FORM,
      "gd_Account@odata.bind": `/accounts(${me.accountId})`,
      "gd_Contact@odata.bind": `/contacts(${me.contactId})`,
    };
    if (input.appId) body["gd_App@odata.bind"] = `/gd_apps(${input.appId})`;
    const id = await this.post("gd_supporttickets", body);
    return this.getTicket(id);
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
    const title = body.length > 80 ? `${body.slice(0, 77)}...` : body;
    const record: ODataRecord = {
      gd_name: title,
      gd_body: body,
      gd_direction: DIRECTION.CUSTOMER,
      gd_authorname: me.fullName,
      "gd_Ticket@odata.bind": `/gd_supporttickets(${ticketId})`,
      "gd_AuthorContact@odata.bind": `/contacts(${me.contactId})`,
    };
    const id = await this.post("gd_supportmessages", record);
    const row = await this.get<ODataRecord>(
      `gd_supportmessages(${id})?$select=gd_supportmessageid,gd_name,gd_body,gd_direction,gd_authorname,createdon,_gd_ticket_value,_gd_authorcontact_value`,
    );
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

  async uploadAttachment(ticketId: string, file: File, messageId?: string): Promise<Attachment> {
    const record: ODataRecord = {
      gd_name: file.name,
      gd_mimetype: file.type || "application/octet-stream",
      gd_isimage: file.type.startsWith("image/"),
      "gd_Ticket@odata.bind": `/gd_supporttickets(${ticketId})`,
    };
    if (messageId) record["gd_Message@odata.bind"] = `/gd_supportmessages(${messageId})`;
    const id = await this.post("gd_ticketattachments", record);
    await this.uploadFile(id, file);
    return {
      id,
      ticketId,
      messageId: messageId ?? null,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      isImage: file.type.startsWith("image/"),
      createdOn: new Date().toISOString(),
    };
  }

  /**
   * Upload the binary into the gd_file column.
   * <=16MB: single PUT (application/octet-stream + x-ms-file-name).
   * >16MB: initial request with x-ms-transfer-mode: chunked, then 4MB
   * blocks with Content-Range: bytes <start>-<end>/<total> until 204.
   */
  private async uploadFile(attachmentId: string, file: File): Promise<void> {
    const base = `${API}/gd_ticketattachments(${attachmentId})/gd_file`;
    const fileName = encodeURIComponent(file.name);

    if (file.size <= SINGLE_UPLOAD_LIMIT) {
      const token = await this.getToken();
      const res = await fetch(`${base}?x-ms-file-name=${fileName}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-ms-file-name": file.name,
          __RequestVerificationToken: token,
        },
        body: file,
      });
      if (!res.ok) throw new Error(`File upload failed: ${res.status} ${await res.text()}`);
      return;
    }

    // Chunked upload — initial handshake.
    const initToken = await this.getToken();
    const initRes = await fetch(`${base}?x-ms-file-name=${fileName}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "x-ms-transfer-mode": "chunked",
        "x-ms-file-name": file.name,
        __RequestVerificationToken: initToken,
      },
    });
    if (!initRes.ok) throw new Error(`Chunked upload init failed: ${initRes.status} ${await initRes.text()}`);
    // The service replies with the upload session URL in Location
    // (falls back to the column URL itself when absent).
    const location = initRes.headers.get("Location") ?? `${base}?x-ms-file-name=${fileName}`;
    const sessionUrl = location.startsWith("http") || location.startsWith("/") ? location : `${base}?${location}`;

    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
      const chunk = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
      const end = Math.min(offset + CHUNK_SIZE, file.size) - 1;
      const token = await this.getToken();
      const res = await fetch(sessionUrl, {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-ms-file-name": file.name,
          "Content-Range": `bytes ${offset}-${end}/${file.size}`,
          __RequestVerificationToken: token,
        },
        body: chunk,
      });
      // 206 PartialContent per chunk, 204 NoContent on the final chunk.
      if (!res.ok) throw new Error(`Chunk upload failed at byte ${offset}: ${res.status} ${await res.text()}`);
    }
  }
}
