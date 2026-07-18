/* ============================================================
   Ticket detail — the mockup's detail screen: pills + subject +
   4-step tracker, status banners (waiting / resolved / closed),
   the conversation thread with inline image previews and file
   chips, and the reply composer with attachments.

   Status transitions owned by this page (per the spec):
   - customer reply while Waiting on Customer / Resolved
     -> back to In Progress
   - "Yes, close ticket" while Resolved -> Closed (+ star rating)
   - "Reopen" while Resolved or Closed  -> In Progress
   ============================================================ */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getProvider } from "../api/provider";
import AttachmentChip from "../components/AttachmentChip";
import EmptyState from "../components/EmptyState";
import FileDrop from "../components/FileDrop";
import Spinner from "../components/Spinner";
import Stars from "../components/Stars";
import StatusPill, { OutlinePill, PriorityPill } from "../components/StatusPill";
import StepTracker from "../components/StepTracker";
import { useToast } from "../components/Toast";
import { useUnread } from "../hooks/useUnread";
import { useSession } from "../session";
import type { Attachment, Message, Ticket } from "../types";
import { DIRECTION, STATE, STATUS, TICKET_TYPE_LABEL, initialsOf } from "../types";
import { dateTime, shortDate, timeAgo } from "./format";

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useSession();
  const toast = useToast();
  const { markSeen } = useUnread();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const provider = getProvider();
      const [t, msgs, atts] = await Promise.all([
        provider.getTicket(id),
        provider.listMessages(id),
        provider.listAttachments(id),
      ]);
      setTicket(t);
      setMessages(msgs);
      setAttachments(atts);
      markSeen(id); // viewing the thread clears the unread dot
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this ticket.");
    } finally {
      setLoading(false);
    }
  }, [id, markSeen]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  /** Attachments grouped per thread message; the rest render below the thread. */
  const { byMessage, orphans } = useMemo(() => {
    const map = new Map<string, Attachment[]>();
    const loose: Attachment[] = [];
    const messageIds = new Set(messages.map((m) => m.id));
    for (const a of attachments) {
      if (a.messageId && messageIds.has(a.messageId)) {
        const list = map.get(a.messageId) ?? [];
        list.push(a);
        map.set(a.messageId, list);
      } else {
        loose.push(a);
      }
    }
    return { byMessage: map, orphans: loose };
  }, [messages, attachments]);

  const setStatus = async (statuscode: number, statecode: number) => {
    if (!ticket) return;
    await getProvider().setStatus(ticket.id, statuscode, statecode);
  };

  const closeTicket = async () => {
    if (!ticket || acting) return;
    setActing(true);
    try {
      await setStatus(STATUS.CLOSED, STATE.INACTIVE);
      toast(
        <>
          Thanks! <b>{ticket.ticketNumber}</b> is closed.
        </>,
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not close the ticket.");
    } finally {
      setActing(false);
    }
  };

  const reopenTicket = async () => {
    if (!ticket || acting) return;
    setActing(true);
    try {
      await setStatus(STATUS.IN_PROGRESS, STATE.ACTIVE);
      toast(
        <>
          <b>{ticket.ticketNumber}</b> reopened — the VelOps team is notified.
        </>,
      );
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reopen the ticket.");
    } finally {
      setActing(false);
    }
  };

  const rateTicket = async (n: number) => {
    if (!ticket) return;
    try {
      await getProvider().rate(ticket.id, n);
      setTicket({ ...ticket, satisfactionRating: n });
      toast(<>Thanks for the {n}/5 rating!</>);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save your rating.");
    }
  };

  const sendReply = async () => {
    if (!ticket || sending) return;
    const text = reply.trim();
    if (!text) {
      toast("Write a reply first.");
      return;
    }
    setSending(true);
    try {
      const provider = getProvider();
      const message = await provider.createMessage(ticket.id, text);
      for (const file of files) {
        await provider.uploadAttachment(ticket.id, file, message.id);
      }
      // Spec transition: a customer reply while Waiting on Customer or
      // Resolved puts the ticket back In Progress.
      if (ticket.statuscode === STATUS.WAITING_ON_CUSTOMER || ticket.statuscode === STATUS.RESOLVED) {
        await setStatus(STATUS.IN_PROGRESS, STATE.ACTIVE);
        toast(
          <>
            Reply sent — <b>{ticket.ticketNumber}</b> is back <b>In Progress</b>.
          </>,
        );
      } else {
        toast("Reply sent — the VelOps team is notified.");
      }
      setReply("");
      setFiles([]);
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send your reply.");
    } finally {
      setSending(false);
    }
  };

  /* ---------------- render ---------------- */

  if (loading) return <Spinner label="Loading ticket" />;

  if (error || !ticket) {
    return (
      <section>
        <Link className="linkback" to="/tickets">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All tickets
        </Link>
        <EmptyState>
          <p>Something went wrong loading this ticket.</p>
          {error ? <p className="hint" style={{ marginTop: 6 }}>{error}</p> : null}
          <div style={{ marginTop: 14 }}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              Try again
            </button>
          </div>
        </EmptyState>
      </section>
    );
  }

  const provider = getProvider();
  const status = ticket.statuscode;

  const banner =
    status === STATUS.WAITING_ON_CUSTOMER ? (
      <div className="banner banner--waiting">
        <div>
          <b>We're waiting on your reply.</b> The VelOps team asked a question below — answer it and
          we'll pick this straight back up.
        </div>
      </div>
    ) : status === STATUS.RESOLVED ? (
      <div className="banner banner--resolved">
        <div>
          <b>This ticket is marked as resolved.</b> Did this solve it for you?
          {ticket.resolutionSummary ? (
            <div style={{ marginTop: 6 }}>
              <b>Resolution:</b> {ticket.resolutionSummary}
            </div>
          ) : null}
          <div className="banner__actions">
            <button type="button" className="btn btn--success btn--sm" onClick={closeTicket} disabled={acting}>
              Yes, close ticket
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={reopenTicket} disabled={acting}>
              No, reopen
            </button>
          </div>
          <Stars value={ticket.satisfactionRating ?? 0} onRate={rateTicket} />
        </div>
      </div>
    ) : status === STATUS.CLOSED ? (
      <div className="banner banner--closed">
        <div>
          <b>This ticket is closed.</b> Need it again? Reopen it below.
          {ticket.satisfactionRating ? <> · Rated {ticket.satisfactionRating}/5.</> : null}
          <div className="banner__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={reopenTicket} disabled={acting}>
              Reopen ticket
            </button>
          </div>
          {!ticket.satisfactionRating ? <Stars value={0} onRate={rateTicket} /> : null}
        </div>
      </div>
    ) : null;

  return (
    <section>
      <Link className="linkback" to="/tickets">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All tickets
      </Link>
      <div className="detail">
        <div>
          <div className="card">
            <div className="dhead">
              <div className="dhead__top">
                <span className="trow__num">{ticket.ticketNumber}</span>
                <StatusPill statuscode={status} />
                <PriorityPill priority={ticket.priority} />
                <OutlinePill>{TICKET_TYPE_LABEL[ticket.tickettype] ?? "Ticket"}</OutlinePill>
                {ticket.appName ? <OutlinePill>{ticket.appName}</OutlinePill> : null}
              </div>
              <h2>{ticket.subject}</h2>
              <StepTracker statuscode={status} />
            </div>

            {banner}

            <div className="thread">
              {messages.length === 0 ? (
                <EmptyState>No messages yet — your description will appear here.</EmptyState>
              ) : (
                messages.map((m) => {
                  const isVel = m.direction === DIRECTION.VELOPS;
                  const author = m.authorName || (isVel ? "VelOps team" : "You");
                  const msgFiles = byMessage.get(m.id) ?? [];
                  return (
                    <div className={`msg ${isVel ? "msg--vel" : "msg--cust"}`} key={m.id}>
                      <div className="msg__avatar">{initialsOf(author)}</div>
                      <div className="msg__body">
                        <div className="msg__who">
                          <span className="name">{author}</span>
                          {isVel ? <span className="tag">VelOps team</span> : null}
                          <span className="when">{dateTime(m.createdOn)}</span>
                        </div>
                        <div className="msg__bubble">{m.body}</div>
                        {msgFiles.length > 0 ? (
                          <div className="msg__files">
                            {msgFiles.map((a) => (
                              <AttachmentChip key={a.id} attachment={a} url={provider.attachmentUrl(a)} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              )}
              {orphans.length > 0 ? (
                <div className="msg__files">
                  {orphans.map((a) => (
                    <AttachmentChip key={a.id} attachment={a} url={provider.attachmentUrl(a)} />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="composer">
              <textarea
                placeholder="Write a reply…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                aria-label="Write a reply"
              />
              <FileDrop onFiles={(picked) => setFiles((cur) => [...cur, ...picked])}>
                <span>Attach a screenshot or file — drop it here or click to browse</span>
              </FileDrop>
              {files.length > 0 ? (
                <div className="composer__files">
                  {files.map((f, i) => (
                    <AttachmentChip
                      key={`${f.name}-${i}`}
                      attachment={{
                        id: `pending-${i}`,
                        ticketId: ticket.id,
                        messageId: null,
                        fileName: f.name,
                        mimeType: f.type || "application/octet-stream",
                        isImage: f.type.startsWith("image/"),
                        createdOn: "",
                      }}
                      onRemove={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                    />
                  ))}
                </div>
              ) : null}
              <div className="composer__row">
                <span className="spacer" />
                <span className="hint">Your reply is added to the ticket and the VelOps team is notified.</span>
                <button type="button" className="btn btn--primary btn--sm" onClick={sendReply} disabled={sending}>
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card meta">
            <h3>Details</h3>
            <dl>
              <div>
                <dt>Team</dt>
                <dd>{ticket.accountName ?? profile.accountName ?? "—"}</dd>
              </div>
              <div>
                <dt>Requester</dt>
                <dd>{ticket.contactName ?? "—"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{TICKET_TYPE_LABEL[ticket.tickettype] ?? "—"}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>
                  <PriorityPill priority={ticket.priority} />
                </dd>
              </div>
              <div>
                <dt>Product area</dt>
                <dd>{ticket.appName ?? "—"}</dd>
              </div>
              <div className="sep" />
              <div>
                <dt>Opened</dt>
                <dd>{shortDate(ticket.createdOn)}</dd>
              </div>
              <div>
                <dt>Last activity</dt>
                <dd>{timeAgo(ticket.modifiedOn)}</dd>
              </div>
              {ticket.satisfactionRating ? (
                <div>
                  <dt>Your rating</dt>
                  <dd>{ticket.satisfactionRating}/5</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
