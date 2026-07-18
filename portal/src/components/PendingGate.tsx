/* ============================================================
   Pending gate — shown on data routes when the signed-in
   contact is not linked to a team yet (parentcustomerid null).
   The VelOps team links new signups from the "Unlinked portal
   signups" view; until then the portal shows this screen.
   ============================================================ */
import { SIGN_OUT_URL } from "./Layout";

export default function PendingGate({ email }: { email?: string | null }) {
  return (
    <div className="pending">
      <div className="card">
        <div className="pending__icon" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <h2>Your account is awaiting activation</h2>
        <p>
          Thanks for signing up{email ? <> with <b>{email}</b></> : null}. The VelOps team is linking your
          account to your team — this usually happens within one business day. You will be able to see and
          create tickets as soon as that is done.
        </p>
        <p className="hint">Need it faster? Mail us at support@velops.cc and we will activate you right away.</p>
        <div className="formfoot">
          <a className="btn btn--ghost" href={SIGN_OUT_URL}>
            Sign out
          </a>
        </div>
      </div>
    </div>
  );
}
