/* Unit tests for the AI intake module's pure logic: tool guard
   rails, draft validation, prompt shape and session flattening. */
import { describe, expect, it } from "vitest";
import { PRIORITY, SOURCE, TICKET_TYPE } from "../types";
import { PRIORITY_FROM_STRING, TICKET_TYPE_FROM_STRING, TOOLS, WRITE_TOOLS, isWriteTool } from "./schema";
import { flattenHistory, sanitizeViewForRestore } from "./sessions";
import { buildSystemPrompt } from "./systemPrompt";
import { parseTicketDraft } from "./tools";
import type { ChatMessage, ViewItem } from "./types";

describe("schema", () => {
  it("exposes exactly the 4 contracted tools", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "get_team_apps",
      "search_my_tickets",
      "create_ticket",
      "no_ticket_needed",
    ]);
  });

  it("gates only create_ticket behind confirmation", () => {
    expect([...WRITE_TOOLS]).toEqual(["create_ticket"]);
    expect(isWriteTool("create_ticket")).toBe(true);
    expect(isWriteTool("search_my_tickets")).toBe(false);
  });

  it("maps model enums to the 12269xxxx option values", () => {
    expect(TICKET_TYPE_FROM_STRING.bug).toBe(TICKET_TYPE.BUG);
    expect(TICKET_TYPE_FROM_STRING.feature_request).toBe(TICKET_TYPE.FEATURE_REQUEST);
    expect(PRIORITY_FROM_STRING.critical).toBe(PRIORITY.CRITICAL);
    expect(SOURCE.AI_ASSISTANT).toBe(122690001);
  });
});

describe("parseTicketDraft", () => {
  const valid = {
    subject: "Riders can't see start times",
    ticket_type: "bug",
    priority: "high",
    description: "## User story\nAs a rider…",
    first_message: "Our riders opened the app and…",
  };

  it("accepts a valid draft and normalizes the app id", () => {
    const d = parseTicketDraft({ ...valid, app_id: "{AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE}" });
    expect(typeof d).not.toBe("string");
    if (typeof d !== "string") {
      expect(d.app_id).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
      expect(d.ticket_type).toBe("bug");
    }
  });

  it("rejects bad enums, missing fields and non-GUID app ids", () => {
    expect(typeof parseTicketDraft({ ...valid, ticket_type: "incident" })).toBe("string");
    expect(typeof parseTicketDraft({ ...valid, priority: "urgent" })).toBe("string");
    expect(typeof parseTicketDraft({ ...valid, first_message: " " })).toBe("string");
    expect(typeof parseTicketDraft({ ...valid, app_id: "not-a-guid" })).toBe("string");
    expect(typeof parseTicketDraft({})).toBe("string");
  });
});

describe("systemPrompt", () => {
  it("caches the static block and injects user, team and apps after the breakpoint", () => {
    const blocks = buildSystemPrompt(
      { fullName: "Jonas Peeters", email: "jonas@team.cc", accountName: "Team Aurora" },
      [{ id: "aa1", appId: "e1", name: "Rider App", description: "For riders" }],
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]!.cache_control).toBeUndefined();
    expect(blocks[1]!.text).toContain("Jonas Peeters");
    expect(blocks[1]!.text).toContain("Team Aurora");
    expect(blocks[1]!.text).toContain("Rider App (app_id: e1)");
  });
});

describe("sessions", () => {
  it("flattens history to alternating text-only turns starting with user", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hello" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "checking" },
          { type: "tool_use", id: "t1", name: "search_my_tickets", input: { query: "x" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }] },
      { role: "assistant", content: [{ type: "text", text: "no matches" }] },
    ];
    const flat = flattenHistory(messages);
    expect(flat).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "checking\n\nno matches" },
    ]);
  });

  it("freezes pending confirms and running tools on restore", () => {
    const view: ViewItem[] = [
      {
        kind: "confirm",
        id: "c1",
        status: "pending",
        draft: { subject: "s", ticket_type: "bug", priority: "low", description: "d", first_message: "m" },
      },
      { kind: "tool", id: "t1", label: "Creating ticket", status: "running" },
    ];
    const restored = sanitizeViewForRestore(view);
    expect(restored[0]).toMatchObject({ kind: "confirm", status: "cancelled" });
    expect(restored[1]).toMatchObject({ kind: "tool", status: "error", detail: "interrupted" });
  });
});
