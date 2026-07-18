/* ============================================================
   Session persistence for the AI intake assistant — localStorage,
   client-side (ported from the hub pattern). A stored session
   keeps BOTH the render model (ViewItem[]) and a FLATTENED
   text-only model history. Tool pairs are deliberately not
   replayed on restore: an assistant message with a dangling
   tool_use is invalid for the API, and the model simply re-calls
   tools when the user asks a follow-up.
   ============================================================ */
import type { ChatMessage, ContentBlock, TextBlock, ViewItem } from "./types";

const KEY = "velops.support.ai.sessions.v1";
export const MAX_SESSIONS = 30;
// Quota discipline: trim on persist, evict on overflow.
const MAX_VIEW_ITEMS = 200;

export interface StoredSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  view: ViewItem[];
  history: ChatMessage[];
}

export function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function readAll(): StoredSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredSession[]) : [];
  } catch {
    return [];
  }
}

function writeAll(sessions: StoredSession[]): void {
  let list = sessions.slice(0, MAX_SESSIONS);
  // Sessions are comfort, not critical data: on quota errors evict the
  // oldest and retry; if even one session won't fit, give up silently.
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return;
    } catch {
      if (list.length <= 1) return;
      list = list.slice(0, list.length - 1);
    }
  }
}

/** All sessions, most recently updated first. */
export function loadSessions(): StoredSession[] {
  return readAll().sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function deleteSession(id: string): StoredSession[] {
  const rest = readAll().filter((s) => s.id !== id);
  writeAll(rest);
  return rest.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Title = the first user message, truncated. */
function titleFrom(view: ViewItem[]): string {
  const first = view.find((it) => it.kind === "user");
  const t = first && first.kind === "user" ? first.text.trim() : "";
  if (!t) return "New session";
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
}

const textOf = (blocks: ContentBlock[]): string =>
  blocks
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

/**
 * Flatten the live message array to a restore-safe history:
 * - user string turns are kept;
 * - tool_result turns are dropped;
 * - assistant block arrays reduce to their concatenated text (thinking
 *   and tool_use dropped — never leave a dangling tool_use);
 * - empty turns are dropped and consecutive same-role turns merged, so
 *   the result always starts with a user turn and alternates cleanly.
 */
export function flattenHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content.trim() : textOf(m.content);
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${text}`;
    } else {
      out.push({ role: m.role, content: text });
    }
  }
  while (out.length && out[0]!.role !== "user") out.shift();
  return out;
}

/** Freeze transient states so a restored view can't show spinners or pending cards. */
export function sanitizeViewForRestore(view: ViewItem[]): ViewItem[] {
  return view.map((it) => {
    if (it.kind === "confirm" && it.status === "pending") return { ...it, status: "cancelled" as const };
    if (it.kind === "tool" && it.status === "running") return { ...it, status: "error" as const, detail: "interrupted" };
    return it;
  });
}

function trimForPersist(view: ViewItem[]): ViewItem[] {
  return view.slice(-MAX_VIEW_ITEMS);
}

/**
 * Upsert the active session after a completed exchange. Skips the write
 * when nothing changed — merely OPENING a session must never rewrite or
 * reorder the list. Returns the fresh, sorted list for state.
 */
export function upsertFromExchange(id: string, view: ViewItem[], messages: ChatMessage[]): StoredSession[] {
  const all = readAll();
  const existing = all.find((s) => s.id === id);
  const now = new Date().toISOString();
  const session: StoredSession = {
    id,
    title: titleFrom(view),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    view: trimForPersist(view),
    history: flattenHistory(messages),
  };
  if (
    existing &&
    JSON.stringify(existing.view) === JSON.stringify(session.view) &&
    JSON.stringify(existing.history) === JSON.stringify(session.history)
  ) {
    return loadSessions();
  }
  const rest = all.filter((s) => s.id !== id);
  writeAll([session, ...rest.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))]);
  return loadSessions();
}
