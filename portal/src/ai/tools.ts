/* ============================================================
   Tool dispatcher — every tool runs client-side through the
   DataProvider as the signed-in portal user, so Power Pages
   table permissions enforce account scoping on every read and
   write. The model never sees raw OData; inputs are validated
   here before anything touches the provider.
   ============================================================ */
import { getProvider } from "../api/provider";
import { SOURCE, STATUS_META } from "../types";
import { PRIORITY_FROM_STRING, TICKET_TYPE_FROM_STRING, isGuid } from "./schema";
import type { TicketDraft, ToolOutcome } from "./types";

const ok = (data: unknown, summary: string): ToolOutcome => ({
  content: JSON.stringify(data),
  is_error: false,
  summary,
});

const fail = (message: string): ToolOutcome => ({
  content: JSON.stringify({ error: message }),
  is_error: true,
  summary: message,
});

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/* ---------------- READ tools ---------------- */

export async function dispatchRead(name: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  try {
    switch (name) {
      case "get_team_apps": {
        const apps = await getProvider().teamApps();
        return ok(
          apps.map((a) => ({ app_id: a.appId, name: a.name, description: a.description })),
          `${apps.length} app${apps.length === 1 ? "" : "s"}`,
        );
      }
      case "search_my_tickets": {
        const query = str(input.query);
        if (!query) return fail("search_my_tickets requires a non-empty query.");
        const tickets = await getProvider().searchMyTickets(query);
        return ok(
          tickets.slice(0, 25).map((t) => ({
            ticket_id: t.id,
            ticket_number: t.ticketNumber,
            subject: t.subject,
            status: STATUS_META[t.statuscode]?.label ?? "Unknown",
            submitted_by: t.contactName,
            last_activity: t.modifiedOn,
          })),
          `${tickets.length} match${tickets.length === 1 ? "" : "es"}`,
        );
      }
      case "no_ticket_needed": {
        // Terminal acknowledgement — the loop renders the green card.
        return ok({ acknowledged: true }, "Question answered");
      }
      default:
        return fail(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : "The request failed.");
  }
}

/* ---------------- WRITE: create_ticket ---------------- */

/** Validate the model-authored input into a renderable draft (or an error string). */
export function parseTicketDraft(input: Record<string, unknown>): TicketDraft | string {
  const subject = str(input.subject);
  const ticket_type = str(input.ticket_type).toLowerCase();
  const priority = str(input.priority).toLowerCase();
  const description = str(input.description);
  const first_message = str(input.first_message);
  const appIdRaw = str(input.app_id);

  if (!subject) return "create_ticket requires a subject.";
  if (!(ticket_type in TICKET_TYPE_FROM_STRING))
    return "ticket_type must be one of: question, complaint, bug, feature_request.";
  if (!(priority in PRIORITY_FROM_STRING)) return "priority must be one of: low, medium, high, critical.";
  if (!description) return "create_ticket requires a description.";
  if (!first_message) return "create_ticket requires a first_message.";
  if (appIdRaw && !isGuid(appIdRaw)) return "app_id must be a GUID from get_team_apps (or omitted).";

  return {
    subject: subject.slice(0, 400),
    ticket_type,
    priority,
    app_id: appIdRaw ? appIdRaw.replace(/[{}]/g, "").toLowerCase() : null,
    description,
    first_message,
  };
}

/**
 * Execute a CONFIRMED create_ticket: create the ticket (status New) and
 * the customer's first message. Runs only after the user clicked
 * "Confirm & create" on the preview card.
 */
export async function executeCreateTicket(draft: TicketDraft): Promise<ToolOutcome> {
  try {
    const provider = getProvider();
    const ticket = await provider.createTicket({
      subject: draft.subject,
      description: draft.description,
      tickettype: TICKET_TYPE_FROM_STRING[draft.ticket_type]!,
      priority: PRIORITY_FROM_STRING[draft.priority]!,
      appId: draft.app_id ?? null,
      source: SOURCE.AI_ASSISTANT,
    });
    // First message = the customer's own words (direction Customer).
    let firstMessageOk = true;
    try {
      await provider.createMessage(ticket.id, draft.first_message);
    } catch {
      firstMessageOk = false; // ticket exists; the story is still in the description
    }
    return {
      content: JSON.stringify({
        ok: true,
        ticket_id: ticket.id,
        ticket_number: ticket.ticketNumber,
        status: "New",
        first_message_created: firstMessageOk,
        portal_url: `/tickets/${ticket.id}`,
      }),
      is_error: false,
      summary: `Created ${ticket.ticketNumber || "ticket"}`,
      ticket: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber || "ticket" },
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Creating the ticket failed.");
  }
}

