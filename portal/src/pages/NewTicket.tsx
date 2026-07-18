/* ============================================================
   New ticket form — the mockup's "Tell us what's going on"
   screen. Submits the ticket (status New, source Portal form),
   posts the description as the first thread message and uploads
   any attached files against that message.
   ============================================================ */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getProvider } from "../api/provider";
import AttachmentChip from "../components/AttachmentChip";
import FileDrop from "../components/FileDrop";
import Spinner from "../components/Spinner";
import { useToast } from "../components/Toast";
import type { TeamApp } from "../types";
import { PRIORITY, PRIORITY_LABEL, TICKET_TYPE, TICKET_TYPE_LABEL } from "../types";

const TYPE_OPTIONS = [
  TICKET_TYPE.QUESTION,
  TICKET_TYPE.COMPLAINT,
  TICKET_TYPE.BUG,
  TICKET_TYPE.FEATURE_REQUEST,
] as const;

const PRIORITY_OPTIONS = [PRIORITY.LOW, PRIORITY.MEDIUM, PRIORITY.HIGH, PRIORITY.CRITICAL] as const;

export default function NewTicket() {
  const navigate = useNavigate();
  const toast = useToast();

  const [apps, setApps] = useState<TeamApp[] | null>(null);
  const [appsError, setAppsError] = useState(false);

  const [subject, setSubject] = useState("");
  const [tickettype, setTickettype] = useState<number>(TICKET_TYPE.QUESTION);
  const [priority, setPriority] = useState<number>(PRIORITY.MEDIUM);
  const [appId, setAppId] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    getProvider()
      .teamApps()
      .then((list) => {
        if (alive) setApps(list);
      })
      .catch(() => {
        if (!alive) return;
        setApps([]);
        setAppsError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const fileChips = useMemo(
    () =>
      files.map((f, i) => ({
        key: `${f.name}-${i}`,
        attachment: {
          id: `pending-${i}`,
          ticketId: "",
          messageId: null,
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          isImage: f.type.startsWith("image/"),
          createdOn: "",
        },
        index: i,
      })),
    [files],
  );

  const submit = async () => {
    const subj = subject.trim();
    const desc = description.trim();
    if (!subj || !desc) {
      toast("Subject and description are required.");
      return;
    }
    if (apps && apps.length > 0 && !appId) {
      toast("Please pick a product area.");
      return;
    }
    setSubmitting(true);
    try {
      const provider = getProvider();
      const ticket = await provider.createTicket({
        subject: subj,
        description: desc,
        tickettype,
        priority,
        appId: appId || null,
      });
      // The description doubles as the first message of the thread.
      const first = await provider.createMessage(ticket.id, desc);
      for (const file of files) {
        await provider.uploadAttachment(ticket.id, file, first.id);
      }
      toast(
        <>
          Ticket <b>{ticket.ticketNumber}</b> created — we'll get back to you within one business day.
        </>,
      );
      navigate(`/tickets/${ticket.id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create the ticket. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <section>
      <Link className="linkback" to="/tickets">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All tickets
      </Link>
      <div className="pagehead">
        <div>
          <div className="eyebrow">New ticket</div>
          <h1>Tell us what's going on</h1>
          <p>Question, complaint, bug or idea — we usually respond within one business day.</p>
        </div>
      </div>
      <div className="formcard">
        <div className="card">
          <div className="field">
            <label htmlFor="fSubject">
              Subject <span className="req">*</span>
            </label>
            <input
              id="fSubject"
              type="text"
              placeholder="Short summary, e.g. “Race calendar not syncing”"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="field2">
            <div className="field">
              <label htmlFor="fType">
                Type <span className="req">*</span>
              </label>
              <select id="fType" value={tickettype} onChange={(e) => setTickettype(Number(e.target.value))}>
                {TYPE_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {TICKET_TYPE_LABEL[v]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fPriority">
                Priority <span className="req">*</span>
              </label>
              <select id="fPriority" value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                {PRIORITY_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {PRIORITY_LABEL[v]}
                  </option>
                ))}
              </select>
              <span className="hint">Critical = race operations at risk / you can't work.</span>
            </div>
          </div>
          <div className="field">
            <label htmlFor="fArea">
              Product area {apps && apps.length > 0 ? <span className="req">*</span> : null}
            </label>
            {apps === null ? (
              <Spinner small label="Loading your team's apps" />
            ) : (
              <select id="fArea" value={appId} onChange={(e) => setAppId(e.target.value)} disabled={apps.length === 0}>
                <option value="">
                  {apps.length === 0 ? "No apps linked to your team yet" : "Select the app this is about…"}
                </option>
                {apps.map((a) => (
                  <option key={a.appId} value={a.appId}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            {appsError ? <span className="hint">Could not load your team's apps — you can still submit the ticket.</span> : null}
          </div>
          <div className="field">
            <label htmlFor="fDesc">
              Description <span className="req">*</span>
            </label>
            <textarea
              id="fDesc"
              placeholder="What happened, what did you expect, and where in the app? Steps to reproduce help us fix it faster."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <span className="hint">
              What happened, what did you expect, and where in the app? Steps to reproduce help us fix it faster.
            </span>
          </div>
          <div className="field">
            <label>Attachments</label>
            <FileDrop onFiles={(picked) => setFiles((cur) => [...cur, ...picked])} />
            {fileChips.length > 0 ? (
              <div className="composer__files">
                {fileChips.map((c) => (
                  <AttachmentChip
                    key={c.key}
                    attachment={c.attachment}
                    onRemove={() => setFiles((cur) => cur.filter((_, i) => i !== c.index))}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="formfoot">
            <button type="button" className="btn btn--primary" onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit ticket"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => navigate("/tickets")} disabled={submitting}>
              Cancel
            </button>
            <span className="spacer" style={{ flex: 1 }} />
          </div>
          <p className="hint" style={{ marginTop: 14 }}>
            Not sure? <Link to="/assistant" style={{ textDecoration: "underline" }}>Ask our assistant</Link> — it helps you
            describe the problem and files the ticket for you.
          </p>
        </div>
      </div>
    </section>
  );
}
