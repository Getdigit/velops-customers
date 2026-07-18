/* ============================================================
   Unread-dot logic. A ticket is "unread" when the latest VelOps
   message is newer than the locally stored last-seen timestamp
   (localStorage key velops-lastseen:<ticketId>). Opening a
   ticket marks it seen.
   ============================================================ */
import { useCallback, useState } from "react";
import type { Message } from "../types";
import { DIRECTION } from "../types";

const KEY_PREFIX = "velops-lastseen:";

export function lastSeen(ticketId: string): number {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + ticketId);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function markSeen(ticketId: string, when: number = Date.now()): void {
  try {
    localStorage.setItem(KEY_PREFIX + ticketId, String(when));
  } catch {
    /* private mode etc. — unread dots just stay on */
  }
}

/** createdon of the newest VelOps-authored message, or null. */
export function latestVelopsMessageOn(messages: Message[]): string | null {
  let latest: string | null = null;
  for (const m of messages) {
    if (m.direction !== DIRECTION.VELOPS) continue;
    if (!latest || m.createdOn > latest) latest = m.createdOn;
  }
  return latest;
}

/** Pure check: unread when the latest VelOps message postdates last-seen. */
export function isUnread(ticketId: string, latestVelopsOn: string | null | undefined): boolean {
  if (!latestVelopsOn) return false;
  const ts = Date.parse(latestVelopsOn);
  if (!Number.isFinite(ts)) return false;
  return ts > lastSeen(ticketId);
}

/**
 * Hook wrapper: exposes isUnread/markSeen and re-renders the consumer
 * when a ticket is marked seen.
 */
export function useUnread(): {
  isUnread: (ticketId: string, latestVelopsOn: string | null | undefined) => boolean;
  markSeen: (ticketId: string, when?: number) => void;
} {
  const [, bump] = useState(0);
  const mark = useCallback((ticketId: string, when?: number) => {
    markSeen(ticketId, when);
    bump((n) => n + 1);
  }, []);
  return { isUnread, markSeen: mark };
}
