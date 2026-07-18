/* ============================================================
   Tool schemas sent to Claude + client-side guard rails.

   Exactly 4 tools. Reads (get_team_apps, search_my_tickets) run
   immediately through the DataProvider as the signed-in portal
   user; the single WRITE tool (create_ticket) is NEVER
   auto-executed — the loop pauses on a confirmation card.
   no_ticket_needed is terminal: it renders the green
   "Question answered — no ticket needed" card.

   NB: this array must stay byte-stable across turns — it is part
   of the cached prompt prefix (see systemPrompt.ts).
   ============================================================ */
import { PRIORITY, TICKET_TYPE } from "../types";

/** Tools that write Dataverse — confirm-gated, never auto-run. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["create_ticket"]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

/** Terminal tool: ends the intake with the green "answered" card. */
export const TERMINAL_TOOL = "no_ticket_needed";

/* Model-facing enum strings -> gd_ option values (12269xxxx block). */
export const TICKET_TYPE_FROM_STRING: Record<string, number> = {
  question: TICKET_TYPE.QUESTION,
  complaint: TICKET_TYPE.COMPLAINT,
  bug: TICKET_TYPE.BUG,
  feature_request: TICKET_TYPE.FEATURE_REQUEST,
};

export const PRIORITY_FROM_STRING: Record<string, number> = {
  low: PRIORITY.LOW,
  medium: PRIORITY.MEDIUM,
  high: PRIORITY.HIGH,
  critical: PRIORITY.CRITICAL,
};

const GUID_RE = /^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i;
export function isGuid(v: unknown): v is string {
  return typeof v === "string" && GUID_RE.test(v.trim());
}

/* --- The Anthropic tools array ----------------------------------- */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: any[] = [
  {
    name: "get_team_apps",
    description:
      "List the VelOps apps linked to the customer's team (id, name, description). Call this before create_ticket when the issue concerns a specific product area, so you can pass the right app_id. The team's apps are also listed in your context — use this tool only if you need to refresh them.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "search_my_tickets",
    description:
      "Search the team's existing support tickets by text (matches subject and ticket number). ALWAYS call this before creating a ticket for a bug or complaint — the customer's team may already have reported this. If you find a likely duplicate, tell the customer (\"you may already have reported this\") with the ticket number and status instead of creating a new ticket.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Free-text search over subject + ticket number (e.g. \"login\", \"VEL-01002\").",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_ticket",
    description:
      "Create a support ticket for the customer's team, plus its first message. This is a WRITE: it is previewed on a confirmation card and only runs after the customer clicks Confirm & create. Before calling it, announce \"I'm creating the ticket for you\" and make sure the description follows the ready-for-development user-story contract. Create ONE ticket per conversation topic.",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Short, specific subject line (max ~100 chars), written like a work-item title.",
        },
        ticket_type: {
          type: "string",
          enum: ["question", "complaint", "bug", "feature_request"],
          description: "The ticket type.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description:
            "Priority. critical = race operations blocked right now; high = blocking daily work; medium = annoying but workaround exists; low = nice to have.",
        },
        app_id: {
          type: "string",
          description:
            "Optional gd_app id (GUID) of the product area, from get_team_apps or the app list in your context. Omit when no single app applies.",
        },
        description: {
          type: "string",
          description:
            "Markdown, ready-for-development. MUST contain these sections: '## User story' (As a…/I want…/So that…), '## Steps to reproduce', '## Expected / Actual', '## Acceptance criteria' (- [ ] checkboxes), '## Context' (app, affected users, urgency).",
        },
        first_message: {
          type: "string",
          description:
            "The customer's own words — their story as they told it to you, lightly cleaned up but NOT rewritten into your structure. This becomes the first message on the ticket thread, from the customer.",
        },
      },
      required: ["subject", "ticket_type", "priority", "description", "first_message"],
    },
  },
  {
    name: "no_ticket_needed",
    description:
      "Terminal: call this when you have fully answered the customer's question and no ticket is needed. The app renders a green \"Question answered — no ticket needed\" card with your summary. After calling it, close politely and invite them back.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "One or two sentences: the question and the answer you gave.",
        },
      },
      required: ["summary"],
    },
  },
];
