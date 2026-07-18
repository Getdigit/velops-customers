/* ============================================================
   Shared types for the AI intake assistant. The agent loop runs
   in the browser (ported from the internal hub's useAiAgent
   pattern); the backend Azure Function is a stateless proxy to
   the Anthropic Messages API (see ./client). Every Dataverse
   read/write is executed client-side through the DataProvider
   as the signed-in portal user — account scoping is enforced by
   Power Pages table permissions, never by the assistant.
   ============================================================ */

/* --- Anthropic Messages API content blocks (the subset we use) --- */
export interface TextBlock {
  type: "text";
  text: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  /** Tool inputs are model-authored JSON; validated client-side before use. */
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

/**
 * A message in the Anthropic conversation array. Assistant content is
 * always the block array we received (echoed back verbatim — thinking
 * blocks included — so the same-model continuation stays valid).
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

/** What the streaming client hands back for one assistant turn. */
export interface AssistantTurn {
  content: ContentBlock[];
  stop_reason: string | null;
  model?: string;
  usage?: Record<string, number>;
}

/* --- Tool dispatch ------------------------------------------------ */

/**
 * Result of executing one tool. `content` is the JSON string fed back
 * to the model as a tool_result; `summary` is short human text for the
 * activity chip.
 */
export interface ToolOutcome {
  content: string;
  is_error: boolean;
  summary: string;
  /** Set by create_ticket: the record to deep-link (/tickets/:id). */
  ticket?: TicketRef;
}

export interface TicketRef {
  ticketId: string;
  ticketNumber: string;
}

/**
 * The create_ticket input the model proposed — rendered on the
 * confirmation card exactly as it will be written.
 */
export interface TicketDraft {
  subject: string;
  ticket_type: string;
  priority: string;
  app_id?: string | null;
  /** Resolved client-side for display on the card. */
  appName?: string | null;
  description: string;
  first_message: string;
}

/* --- Render model ------------------------------------------------- */
/** The conversation array above is the API source of truth; this is
    the render model the chat paints. */
export type ViewItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { kind: "confirm"; id: string; status: "pending" | "confirmed" | "cancelled"; draft: TicketDraft }
  | { kind: "answered"; id: string; summary: string } // green "no ticket needed" card
  | { kind: "ticket-link"; id: string; ticket: TicketRef }
  | { kind: "notice"; id: string; text: string }
  | { kind: "error"; id: string; text: string };

export type AgentStatus =
  | "idle"
  | "thinking"
  | "streaming"
  | "running-tools"
  | "awaiting-confirm"
  | "error";
