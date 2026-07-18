/* ============================================================
   /assistant — the AI intake chat (mockup: "Not sure? Ask our
   assistant"). Structure ported from the hub's AiAssistant
   drawer, laid out as a full page card on the portal design
   system. Sessions live in localStorage; the agent loop is
   useAiAgent (write tool confirm-gated).
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getProvider } from "../api/provider";
import PendingGate from "../components/PendingGate";
import { useSession } from "../session";
import type { TeamApp } from "../types";
import { isPending } from "../types";
import { ChatItem } from "./ChatItems";
import { AI_PROXY_CONFIGURED } from "./config";
import type { ChatMessage, ViewItem } from "./types";
import {
  deleteSession,
  loadSessions,
  newSessionId,
  sanitizeViewForRestore,
  upsertFromExchange,
  type StoredSession,
} from "./sessions";
import { useAiAgent } from "./useAiAgent";
import "./ai.css";

const SUGGESTIONS: string[] = [
  "Riders can't see tomorrow's start time in the app",
  "How do I add a new staff member to our team?",
  "The travel screen shows the wrong hotel for our next race",
  "We'd love an export of race days to Excel",
];

function firstName(full?: string | null): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

export default function AssistantPage() {
  const { profile } = useSession();

  const [teamApps, setTeamApps] = useState<TeamApp[]>([]);
  const [sessions, setSessions] = useState<StoredSession[]>(() => loadSessions());
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const onExchangeComplete = useCallback((view: ViewItem[], messages: ChatMessage[]) => {
    setSessions(upsertFromExchange(sessionIdRef.current, view, messages));
  }, []);

  const agent = useAiAgent(profile, teamApps, { onExchangeComplete });

  useEffect(() => {
    let alive = true;
    getProvider()
      .teamApps()
      .then((apps) => {
        if (alive) setTeamApps(apps);
      })
      .catch(() => {
        /* the assistant still works without the app list */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [agent.view, agent.status]);

  const startNew = useCallback(() => {
    setSessionId(newSessionId());
    agent.reset();
  }, [agent]);

  const openSession = useCallback(
    (s: StoredSession) => {
      setSessionId(s.id);
      agent.restore(sanitizeViewForRestore(s.view), s.history);
    },
    [agent],
  );

  const removeSession = useCallback(
    (id: string) => {
      setSessions(deleteSession(id));
      if (id === sessionIdRef.current) startNew();
    },
    [startNew],
  );

  const inputDisabled = (agent.status !== "idle" && agent.status !== "error") || agent.capped;

  const submit = () => {
    if (!draft.trim() || inputDisabled) return;
    agent.send(draft);
    setDraft("");
  };

  const greeting = firstName(profile?.fullName);
  const recent = useMemo(() => sessions.slice(0, 8), [sessions]);

  // Defensive: the AuthGate already shows the pending gate, but the
  // assistant must never run for an unlinked contact.
  if (isPending(profile)) return <PendingGate email={profile?.email} />;

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{profile.accountName ?? "Your team"}</div>
          <h1>AI assistant</h1>
          <p>Describe your problem in your own words — I'll answer it, or turn it into a well-written ticket.</p>
        </div>
        <div className="spacer" />
        <Link className="btn btn--ghost" to="/tickets">
          Back to tickets
        </Link>
      </div>

      {!AI_PROXY_CONFIGURED && (
        <div className="ai-setup-note">
          The AI assistant isn't connected yet — the VelOps team is finishing its setup. In the meantime you can{" "}
          <Link to="/tickets/new">create a ticket the regular way</Link>.
        </div>
      )}

      <div className="ai-layout">
        <div className="card ai-chat">
          <div className="ai-chat__body">
            {agent.view.length === 0 && (
              <div className="ai-welcome">
                <p className="ai-welcome__hi">{greeting ? `Hi ${greeting} — ` : ""}what's going on?</p>
                <p className="ai-welcome__sub">
                  I'll ask a couple of focused questions first. If it needs the VelOps team, I'll draft the ticket and
                  you approve it before anything is created.
                </p>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} type="button" className="ai-suggestion" onClick={() => agent.send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {agent.view.map((item) => (
              <ChatItem key={item.id} item={item} busy={agent.busy} onConfirm={agent.confirm} onCancel={agent.cancel} />
            ))}

            {agent.status === "thinking" && (
              <div className="ai-thinking">
                <div className="loading-spinner loading-spinner--sm ai-spin-sm" />
                <span>Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="ai-chat__foot">
            <div className="ai-composer">
              <textarea
                className="ai-input"
                placeholder={
                  agent.capped
                    ? "Session limit reached — start a new session"
                    : inputDisabled
                      ? "Working…"
                      : "Describe your problem or question…"
                }
                value={draft}
                disabled={inputDisabled}
                rows={1}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
              />
              {agent.canStop ? (
                <button type="button" className="btn btn--ghost" onClick={agent.stop}>
                  Stop
                </button>
              ) : (
                <button type="button" className="btn btn--dark" onClick={submit} disabled={inputDisabled || !draft.trim()}>
                  Send
                </button>
              )}
            </div>
            <div className="ai-disclaimer hint">
              The assistant can create tickets on your behalf — it always asks first.
            </div>
          </div>
        </div>

        <aside className="ai-side">
          <div className="card ai-sessions">
            <div className="ai-sessions__head">
              <span className="ai-sessions__title">Sessions</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={startNew}>
                New session
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="ai-sessions__empty hint">Previous conversations show up here (stored on this device).</div>
            ) : (
              <ul className="ai-sessions__list">
                {recent.map((s) => (
                  <li key={s.id} className={`ai-sessions__row${s.id === sessionId ? " is-active" : ""}`}>
                    <button type="button" className="ai-sessions__open" onClick={() => openSession(s)} title={s.title}>
                      {s.title}
                    </button>
                    <button
                      type="button"
                      className="ai-sessions__del"
                      aria-label="Delete session"
                      onClick={() => removeSession(s.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="card ai-tips">
            <div className="ai-tips__title">Good to know</div>
            <ul>
              <li>I only see your team's own tickets.</li>
              <li>Bug reports work best with exact steps.</li>
              <li>
                Prefer a form? <Link to="/tickets/new">Create a ticket manually</Link>.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
