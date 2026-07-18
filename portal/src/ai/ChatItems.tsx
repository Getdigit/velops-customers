/* ============================================================
   Chat item renderer — one switch over the ViewItem union
   (ported from the hub's ChatItems, adapted to the portal's
   design system + the intake-specific cards: the create_ticket
   confirmation preview, the green "no ticket needed" card and
   the "View ticket VEL-xxxxx" deep link).
   ============================================================ */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TicketDraft, ViewItem } from "./types";
import "./ai.css";

/* ---------- markdown-lite ----------
   Assistant replies and ticket descriptions use light Markdown
   (## headings, bullets, checkboxes, **bold**, `code`). Rendered
   deterministically with no dependencies — anything unrecognized
   falls through as plain pre-wrap text. */

function inline(text: string, keyBase: string): ReactNode[] {
  // Split on **bold** and `code` spans.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return <strong key={`${keyBase}-${i}`}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith("`") && p.endsWith("`") && p.length > 2) {
      return (
        <code key={`${keyBase}-${i}`} className="ai-code">
          {p.slice(1, -1)}
        </code>
      );
    }
    return p;
  });
}

export function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="ai-md">
      {lines.map((line, i) => {
        const key = `l${i}`;
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
          return (
            <div key={key} className="ai-md__h">
              {inline(h[2]!, key)}
            </div>
          );
        }
        const check = line.match(/^\s*-\s+\[( |x|X)\]\s+(.*)$/);
        if (check) {
          return (
            <div key={key} className="ai-md__check">
              <span className="ai-md__box" aria-hidden="true">
                {check[1]!.trim() ? "☑" : "☐"}
              </span>
              <span>{inline(check[2]!, key)}</span>
            </div>
          );
        }
        const bullet = line.match(/^\s*[-*]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={key} className="ai-md__li">
              <span className="ai-md__dot" aria-hidden="true">
                ›
              </span>
              <span>{inline(bullet[1]!, key)}</span>
            </div>
          );
        }
        const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (num) {
          return (
            <div key={key} className="ai-md__li">
              <span className="ai-md__num">{num[1]}.</span>
              <span>{inline(num[2]!, key)}</span>
            </div>
          );
        }
        return <div key={key}>{line ? inline(line, key) : " "}</div>;
      })}
    </div>
  );
}

/* ---------- confirmation card ---------- */

const TYPE_LABEL: Record<string, string> = {
  question: "Question",
  complaint: "Complaint",
  bug: "Bug",
  feature_request: "Feature request",
};
const PRIORITY_LABEL: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function ConfirmCard({
  id,
  status,
  draft,
  busy,
  onConfirm,
  onCancel,
}: {
  id: string;
  status: "pending" | "confirmed" | "cancelled";
  draft: TicketDraft;
  busy: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  return (
    <div className="ai-confirm">
      <div className="ai-confirm__title">Ready to create this ticket?</div>
      <div className="ai-confirm__grid">
        <div className="ai-confirm__label">Subject</div>
        <div className="ai-confirm__value">{draft.subject}</div>
        <div className="ai-confirm__label">Type</div>
        <div className="ai-confirm__value">{TYPE_LABEL[draft.ticket_type] ?? draft.ticket_type}</div>
        <div className="ai-confirm__label">Priority</div>
        <div className="ai-confirm__value">{PRIORITY_LABEL[draft.priority] ?? draft.priority}</div>
        <div className="ai-confirm__label">Product area</div>
        <div className="ai-confirm__value">{draft.appName ?? (draft.app_id ? draft.app_id : "—")}</div>
      </div>
      <details className="ai-confirm__desc" open={status === "pending"}>
        <summary>Description (what our developers will see)</summary>
        <div className="ai-confirm__descbody">
          <MarkdownLite text={draft.description} />
        </div>
      </details>
      <details className="ai-confirm__desc">
        <summary>Your first message on the thread</summary>
        <div className="ai-confirm__descbody">
          <MarkdownLite text={draft.first_message} />
        </div>
      </details>
      {status === "pending" ? (
        <div className="ai-confirm__actions">
          <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => onConfirm(id)}>
            Confirm &amp; create
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onCancel(id)}>
            Cancel
          </button>
        </div>
      ) : (
        <span className={`pill ${status === "confirmed" ? "st-resolved" : "st-closed"}`}>
          {status === "confirmed" ? "Created" : "Cancelled"}
        </span>
      )}
    </div>
  );
}

/* ---------- the switch ---------- */

export function ChatItem({
  item,
  busy,
  onConfirm,
  onCancel,
}: {
  item: ViewItem;
  busy: boolean;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  switch (item.kind) {
    case "user":
      return <div className="ai-bubble ai-bubble--user">{item.text}</div>;
    case "assistant":
      return item.text ? (
        <div className="ai-bubble ai-bubble--bot">
          <MarkdownLite text={item.text} />
        </div>
      ) : (
        <div className="ai-bubble ai-bubble--bot ai-bubble--pending">
          <span className="skeleton ai-skel" />
        </div>
      );
    case "tool":
      return (
        <div className={`ai-tool ai-tool--${item.status}`}>
          <span className="ai-tool__dot" aria-hidden="true">
            {item.status === "running" ? <span className="loading-spinner loading-spinner--sm ai-spin-xs" /> : item.status === "done" ? "✓" : "!"}
          </span>
          <span className="ai-tool__label">{item.label}</span>
          {item.detail && <span className="ai-tool__detail">{item.detail}</span>}
        </div>
      );
    case "confirm":
      return (
        <ConfirmCard
          id={item.id}
          status={item.status}
          draft={item.draft}
          busy={busy}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
    case "answered":
      return (
        <div className="ai-answered">
          <div className="ai-answered__head">
            <span className="ai-answered__icon" aria-hidden="true">
              ✓
            </span>
            Question answered — no ticket needed
          </div>
          {item.summary ? <div className="ai-answered__sum">{item.summary}</div> : null}
        </div>
      );
    case "ticket-link":
      return (
        <div className="ai-links">
          <Link className="btn btn--dark btn--sm" to={`/tickets/${item.ticket.ticketId}`}>
            View ticket {item.ticket.ticketNumber}
          </Link>
        </div>
      );
    case "notice":
      return <div className="ai-notice">{item.text}</div>;
    case "error":
      return <div className="ai-error">{item.text}</div>;
    default:
      return null;
  }
}
