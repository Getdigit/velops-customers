/* ============================================================
   The client-side agent loop (ported from the hub's useAiAgent).
   State lives in React; the backend is a stateless proxy. Per
   user turn we POST the message array + tool schemas and run the
   classic tool-use loop (capped at MAX_TOOL_ITERATIONS): the
   assistant returns text and/or tool_use blocks → READ tools run
   immediately and feed results back → the WRITE tool
   (create_ticket) is NEVER auto-run: the loop pauses and renders
   a confirmation card; only after "Confirm & create" does the
   write execute (Cancel returns a {cancelled:true} tool_result so
   the model adapts). Then we re-POST until a final text answer.

   Stop semantics: `stop()` is a soft-stop — a generation counter
   invalidates the running loop, whose in-flight result is
   discarded on arrival. Stop also repairs the history: a trailing
   assistant turn with unanswered tool_use blocks is popped,
   because a dangling tool_use makes the next request invalid.
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Profile, TeamApp } from "../types";
import { postMessages } from "./client";
import { AI_PROXY_CONFIGURED, MAX_TOOL_ITERATIONS, MAX_TURNS } from "./config";
import { TOOLS, isWriteTool } from "./schema";
import { buildSystemPrompt } from "./systemPrompt";
import { dispatchRead, executeCreateTicket, parseTicketDraft } from "./tools";
import type {
  AgentStatus,
  ChatMessage,
  ContentBlock,
  TextBlock,
  TicketDraft,
  ToolUseBlock,
  ViewItem,
} from "./types";

// Ids must stay unique ACROSS page loads: restored sessions carry the
// ids they were persisted with, and patch()/drop()/React keys match on
// id — a bare counter (restarting every load) would collide with them.
const RUN = Math.random().toString(36).slice(2, 8);
let _id = 0;
const uid = () => `ai-${RUN}-${++_id}`;

const LABELS: Record<string, string> = {
  get_team_apps: "Reading your team's apps",
  search_my_tickets: "Searching your tickets",
  create_ticket: "Creating ticket",
  no_ticket_needed: "Wrapping up",
};
const labelFor = (t: ToolUseBlock) => LABELS[t.name] ?? t.name;

interface Pending {
  readResults: ContentBlock[];
  write: ToolUseBlock;
  draft: TicketDraft;
  /** Error tool_results for surplus create_ticket calls in the same turn. */
  extraResults: ContentBlock[];
  iteration: number;
  confirmId: string;
}

export interface AiAgentOptions {
  /** Fires when the loop settles (idle/error) so the caller can persist the session. */
  onExchangeComplete?: (view: ViewItem[], messages: ChatMessage[]) => void;
}

export interface AiAgent {
  view: ViewItem[];
  status: AgentStatus;
  busy: boolean;
  /** True while a soft-stop is possible (busy, but not confirming/writing). */
  canStop: boolean;
  /** True once the session hit the turn cap — start a fresh session. */
  capped: boolean;
  send: (text: string) => void;
  confirm: (confirmId: string) => void;
  cancel: (confirmId: string) => void;
  stop: () => void;
  reset: () => void;
  /** Replace conversation + view (loading a stored session). */
  restore: (view: ViewItem[], history: ChatMessage[]) => void;
}

const toolResult = (id: string, content: string, isError: boolean): ContentBlock => ({
  type: "tool_result",
  tool_use_id: id,
  content,
  is_error: isError,
});

const userTurns = (messages: ChatMessage[]): number => messages.filter((m) => m.role === "user").length;

export function useAiAgent(profile: Profile, teamApps: TeamApp[], opts?: AiAgentOptions): AiAgent {
  const [view, setView] = useState<ViewItem[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [capped, setCapped] = useState(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const pendingRef = useRef<Pending | null>(null);
  // Bumped by stop()/reset()/restore(): a loop that captured an older
  // value discards whatever its in-flight await eventually returns.
  const genRef = useRef(0);
  // True while a confirmed write executes — stop is disabled there.
  const writingRef = useRef(false);
  const [writing, setWriting] = useState(false);
  const optsRef = useRef<AiAgentOptions | undefined>(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const appsRef = useRef<TeamApp[]>(teamApps);
  useEffect(() => {
    appsRef.current = teamApps;
  }, [teamApps]);

  const append = useCallback((item: ViewItem) => setView((v) => [...v, item]), []);
  const patch = useCallback(
    (id: string, fn: (it: ViewItem) => ViewItem) => setView((v) => v.map((it) => (it.id === id ? fn(it) : it))),
    [],
  );
  const drop = useCallback((id: string) => setView((v) => v.filter((it) => it.id !== id)), []);

  // Persist-on-settle: fire the exchange callback when the loop
  // transitions into idle/error (state has flushed by then).
  const prevStatusRef = useRef<AgentStatus>("idle");
  useEffect(() => {
    const was = prevStatusRef.current;
    prevStatusRef.current = status;
    if (was !== status && was !== "idle" && (status === "idle" || status === "error") && view.length > 0) {
      optsRef.current?.onExchangeComplete?.(view, messagesRef.current);
    }
  }, [status, view]);

  const runReads = useCallback(
    async (reads: ToolUseBlock[], gen: number): Promise<ContentBlock[]> => {
      const results: ContentBlock[] = [];
      for (const t of reads) {
        if (gen !== genRef.current) break;
        const chip = uid();
        append({ kind: "tool", id: chip, label: labelFor(t), status: "running" });
        const out = await dispatchRead(t.name, t.input);
        if (gen !== genRef.current) break;
        patch(chip, (it) =>
          it.kind === "tool" ? { ...it, status: out.is_error ? "error" : "done", detail: out.summary } : it,
        );
        // Terminal tool: render the green "no ticket needed" card.
        if (t.name === "no_ticket_needed" && !out.is_error) {
          append({ kind: "answered", id: uid(), summary: String(t.input?.summary ?? "") });
        }
        results.push(toolResult(t.id, out.content, out.is_error));
      }
      return results;
    },
    [append, patch],
  );

  const driveLoop = useCallback(
    async (start: number) => {
      const gen = genRef.current;
      let iteration = start;
      while (iteration < MAX_TOOL_ITERATIONS) {
        setStatus("thinking");
        const slot = uid();
        append({ kind: "assistant", id: slot, text: "" });
        let turn;
        try {
          turn = await postMessages(
            messagesRef.current,
            buildSystemPrompt(
              { fullName: profile.fullName, email: profile.email, accountName: profile.accountName },
              appsRef.current,
            ),
            TOOLS,
            {
              onText: (d) => {
                if (gen !== genRef.current) return;
                setStatus("streaming");
                patch(slot, (it) => (it.kind === "assistant" ? { ...it, text: it.text + d } : it));
              },
            },
          );
        } catch (e) {
          drop(slot);
          if (gen !== genRef.current) return; // stopped — swallow the stale failure
          append({ kind: "error", id: uid(), text: e instanceof Error ? e.message : "Request failed." });
          setStatus("error");
          return;
        }
        if (gen !== genRef.current) {
          drop(slot);
          return; // stopped mid-call — discard
        }
        messagesRef.current = messagesRef.current.concat([{ role: "assistant", content: turn.content }]);
        const text = turn.content
          .filter((b): b is TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");
        if (text) patch(slot, (it) => (it.kind === "assistant" ? { ...it, text } : it));
        else drop(slot);

        const toolUses = turn.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
        if (turn.stop_reason !== "tool_use" || toolUses.length === 0) {
          setStatus("idle");
          return;
        }

        const reads = toolUses.filter((t) => !isWriteTool(t.name));
        const writes = toolUses.filter((t) => isWriteTool(t.name));
        setStatus("running-tools");
        const readResults = await runReads(reads, gen);
        if (gen !== genRef.current) return; // stopped mid-tools — stop() repaired the history

        if (writes.length === 0) {
          messagesRef.current = messagesRef.current.concat([{ role: "user", content: readResults }]);
          iteration += 1;
          continue;
        }

        // One ticket at a time: preview the first create_ticket, decline
        // any surplus in the same turn with an error tool_result.
        const write = writes[0]!;
        const extraResults = writes
          .slice(1)
          .map((w) =>
            toolResult(w.id, JSON.stringify({ error: "One ticket at a time — this call was not executed." }), true),
          );
        const parsed = parseTicketDraft(write.input);
        if (typeof parsed === "string") {
          // Invalid draft: bounce it straight back so the model fixes it.
          messagesRef.current = messagesRef.current.concat([
            {
              role: "user",
              content: [...readResults, toolResult(write.id, JSON.stringify({ error: parsed }), true), ...extraResults],
            },
          ]);
          iteration += 1;
          continue;
        }
        const draft: TicketDraft = {
          ...parsed,
          appName: parsed.app_id ? (appsRef.current.find((a) => a.appId === parsed.app_id)?.name ?? null) : null,
        };

        // Pause the loop for explicit confirmation of the write.
        const confirmId = uid();
        pendingRef.current = { readResults, write, draft, extraResults, iteration: iteration + 1, confirmId };
        append({ kind: "confirm", id: confirmId, status: "pending", draft });
        setStatus("awaiting-confirm");
        return;
      }
      append({
        kind: "error",
        id: uid(),
        text: "Reached the step limit for this request — ask me to continue if needed.",
      });
      setStatus("idle");
    },
    [append, patch, drop, runReads, profile],
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      // 'error' is a settled state too — a new message recovers the session.
      if (!text || (status !== "idle" && status !== "error")) return;
      if (userTurns(messagesRef.current) >= MAX_TURNS) {
        setCapped(true);
        append({
          kind: "notice",
          id: uid(),
          text: "This conversation is getting long — let's start a fresh session so I stay sharp. Your tickets are saved; just hit New session and pick up where we left off.",
        });
        return;
      }
      append({ kind: "user", id: uid(), text });
      if (!AI_PROXY_CONFIGURED) {
        append({
          kind: "error",
          id: uid(),
          text: "The AI assistant is not configured yet (VITE_AI_PROXY_URL is unset). You can still create a ticket the regular way via New ticket.",
        });
        return;
      }
      // After a stop the history can already end in a user turn. Merge
      // instead of pushing a consecutive user message.
      const msgs = messagesRef.current;
      const last = msgs[msgs.length - 1];
      if (last?.role === "user" && typeof last.content === "string") {
        messagesRef.current = [...msgs.slice(0, -1), { role: "user", content: `${last.content}\n\n${text}` }];
      } else if (last?.role === "user" && Array.isArray(last.content)) {
        messagesRef.current = [...msgs.slice(0, -1), { role: "user", content: [...last.content, { type: "text", text }] }];
      } else {
        messagesRef.current = msgs.concat([{ role: "user", content: text }]);
      }
      void driveLoop(0);
    },
    [status, append, driveLoop],
  );

  const confirm = useCallback(
    async (confirmId: string) => {
      const p = pendingRef.current;
      if (!p || p.confirmId !== confirmId) return;
      pendingRef.current = null;
      // Captured so a reset()/restore() during the write can't append
      // orphan results into an unrelated history.
      const gen = genRef.current;
      patch(confirmId, (it) => (it.kind === "confirm" ? { ...it, status: "confirmed" } : it));
      setStatus("running-tools");
      writingRef.current = true;
      setWriting(true);
      const chip = uid();
      if (gen === genRef.current) append({ kind: "tool", id: chip, label: labelFor(p.write), status: "running" });
      let out;
      try {
        out = await executeCreateTicket(p.draft);
      } finally {
        writingRef.current = false;
        setWriting(false);
      }
      if (gen === genRef.current) {
        patch(chip, (it) =>
          it.kind === "tool" ? { ...it, status: out.is_error ? "error" : "done", detail: out.summary } : it,
        );
        if (out.ticket) append({ kind: "ticket-link", id: uid(), ticket: out.ticket });
      }
      console.info("[AI write]", { tool: p.write.name, ok: !out.is_error, ticket: out.ticket });
      if (gen !== genRef.current) return; // session switched mid-write — skip the follow-up
      messagesRef.current = messagesRef.current.concat([
        { role: "user", content: [...p.readResults, toolResult(p.write.id, out.content, out.is_error), ...p.extraResults] },
      ]);
      void driveLoop(p.iteration);
    },
    [append, patch, driveLoop],
  );

  const cancel = useCallback(
    (confirmId: string) => {
      const p = pendingRef.current;
      if (!p || p.confirmId !== confirmId) return;
      pendingRef.current = null;
      patch(confirmId, (it) => (it.kind === "confirm" ? { ...it, status: "cancelled" } : it));
      messagesRef.current = messagesRef.current.concat([
        {
          role: "user",
          content: [
            ...p.readResults,
            toolResult(p.write.id, JSON.stringify({ cancelled: true, note: "The customer declined this ticket." }), false),
            ...p.extraResults,
          ],
        },
      ]);
      void driveLoop(p.iteration);
    },
    [patch, driveLoop],
  );

  const stop = useCallback(() => {
    if (pendingRef.current || writingRef.current) return; // never during confirm/write
    genRef.current++;
    // History repair: a trailing assistant turn whose tool_use results
    // were never appended would 400 the next request — drop it entirely.
    const msgs = messagesRef.current;
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && Array.isArray(last.content) && last.content.some((b) => b.type === "tool_use")) {
      messagesRef.current = msgs.slice(0, -1);
    }
    // Freeze running tool chips and remove the empty streaming slot.
    setView((v) =>
      v
        .filter((it) => !(it.kind === "assistant" && !it.text))
        .map((it) => (it.kind === "tool" && it.status === "running" ? { ...it, status: "error" as const, detail: "stopped" } : it)),
    );
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    genRef.current++;
    messagesRef.current = [];
    pendingRef.current = null;
    setCapped(false);
    setView([]);
    setStatus("idle");
  }, []);

  const restore = useCallback((restoredView: ViewItem[], history: ChatMessage[]) => {
    genRef.current++;
    messagesRef.current = history;
    pendingRef.current = null;
    setCapped(userTurns(history) >= MAX_TURNS);
    setView(restoredView);
    setStatus("idle");
  }, []);

  const busy = status === "thinking" || status === "streaming" || status === "running-tools";
  const canStop = busy && !writing;
  return { view, status, busy, canStop, capped, send, confirm, cancel, stop, reset, restore };
}
