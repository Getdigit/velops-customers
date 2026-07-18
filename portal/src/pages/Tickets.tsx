/* ============================================================
   Ticket list — the mockup's "Your tickets" screen. Filter
   chips with live counts, search over subject + ticket number,
   unread dots for new VelOps replies, and the New ticket / AI
   assistant actions.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getProvider } from "../api/provider";
import EmptyState from "../components/EmptyState";
import FilterChip from "../components/FilterChip";
import Spinner from "../components/Spinner";
import StatusPill, { PriorityPill } from "../components/StatusPill";
import { latestVelopsMessageOn, useUnread } from "../hooks/useUnread";
import { useSession } from "../session";
import type { Ticket } from "../types";
import { TICKET_TYPE_LABEL, isOpen, isSettled, waitingOnCustomer } from "../types";
import { shortDate, timeAgo } from "./format";

/* ---------- filter model (pure — unit tested) ---------- */
export type TicketFilter = "all" | "open" | "waiting" | "done";

export const FILTERS: { key: TicketFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "waiting", label: "Waiting on you" },
  { key: "done", label: "Resolved & closed" },
];

/** Mockup's matchesFilter, keyed on statuscode. */
export function matchesFilter(statuscode: number, filter: TicketFilter): boolean {
  if (filter === "open") return isOpen(statuscode);
  if (filter === "waiting") return waitingOnCustomer(statuscode);
  if (filter === "done") return isSettled(statuscode);
  return true;
}

/** Search predicate over subject + ticket number (case-insensitive). */
export function matchesSearch(t: Pick<Ticket, "subject" | "ticketNumber">, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return `${t.subject} ${t.ticketNumber}`.toLowerCase().includes(needle);
}

/* ---------- page ---------- */
export default function Tickets() {
  const { profile } = useSession();
  const navigate = useNavigate();
  const { isUnread } = useUnread();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  /** ticketId -> createdon of the newest VelOps message (unread dots). */
  const [latestVelops, setLatestVelops] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const provider = getProvider();
        const list = await provider.listTickets();
        if (!alive) return;
        setTickets(list);
        setLoading(false);
        // Unread dots need the newest VelOps message per ticket; fetch
        // threads in the background so the list renders immediately.
        const entries = await Promise.all(
          list.map(async (t) => {
            try {
              const messages = await provider.listMessages(t.id);
              return [t.id, latestVelopsMessageOn(messages)] as const;
            } catch {
              return [t.id, null] as const;
            }
          }),
        );
        if (!alive) return;
        const map: Record<string, string> = {};
        for (const [id, on] of entries) if (on) map[id] = on;
        setLatestVelops(map);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Could not load your tickets.");
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<TicketFilter, number> = { all: 0, open: 0, waiting: 0, done: 0 };
    for (const t of tickets) {
      for (const f of FILTERS) if (matchesFilter(t.statuscode, f.key)) c[f.key] += 1;
    }
    return c;
  }, [tickets]);

  const rows = useMemo(
    () => tickets.filter((t) => matchesFilter(t.statuscode, filter)).filter((t) => matchesSearch(t, q)),
    [tickets, filter, q],
  );

  if (loading) return <Spinner label="Loading tickets" />;

  if (error) {
    return (
      <EmptyState>
        <p>Something went wrong loading your tickets.</p>
        <p className="hint" style={{ marginTop: 6 }}>{error}</p>
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </EmptyState>
    );
  }

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{profile.accountName ?? "Your team"}</div>
          <h1>Your tickets</h1>
          <p>Questions &amp; complaints about your VelOps environment — we keep you posted here.</p>
        </div>
        <div className="spacer" />
        <Link className="btn btn--ghost" to="/assistant">
          Not sure? Ask our assistant
        </Link>
        <Link className="btn btn--primary" to="/tickets/new">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New ticket
        </Link>
      </div>

      <div className="toolrow">
        {FILTERS.map((f) => (
          <FilterChip key={f.key} active={filter === f.key} count={counts[f.key]} onClick={() => setFilter(f.key)}>
            {f.label}
          </FilterChip>
        ))}
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="text"
            placeholder="Search tickets…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
      </div>

      <div className="tlist">
        {rows.length === 0 ? (
          <EmptyState />
        ) : (
          rows.map((t) => (
            <div
              className="trow"
              key={t.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/tickets/${t.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter") navigate(`/tickets/${t.id}`);
              }}
            >
              <div className="trow__main">
                <div className="trow__num">{t.ticketNumber}</div>
                <div className="trow__subject">
                  {isUnread(t.id, latestVelops[t.id]) ? (
                    <span className="dot-unread" title="New reply from VelOps" />
                  ) : null}
                  {t.subject}
                </div>
                <div className="trow__meta">
                  {TICKET_TYPE_LABEL[t.tickettype] ?? "Ticket"}
                  {t.appName ? <> · {t.appName}</> : null} · opened {shortDate(t.createdOn)}
                  {t.contactName ? (
                    <>
                      {" "}by <b>{t.contactName}</b>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="trow__right">
                <PriorityPill priority={t.priority} />
                <StatusPill statuscode={t.statuscode} />
                <div className="trow__when">{timeAgo(t.modifiedOn)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
