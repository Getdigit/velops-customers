/* ============================================================
   Profile — editable contact details (email stays read-only,
   it is the sign-in identity), the team card with linked apps
   and team members, and sign-out.
   ============================================================ */
import { useEffect, useState } from "react";
import { getProvider } from "../api/provider";
import { SIGN_OUT_URL } from "../components/Layout";
import Spinner from "../components/Spinner";
import { OutlinePill } from "../components/StatusPill";
import { useToast } from "../components/Toast";
import { useSession } from "../session";
import type { TeamApp, TeamMember } from "../types";
import { initialsOf } from "../types";

export default function Profile() {
  const { profile, refreshProfile } = useSession();
  const toast = useToast();

  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [saving, setSaving] = useState(false);

  const [apps, setApps] = useState<TeamApp[] | null>(null);
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [teamError, setTeamError] = useState(false);

  useEffect(() => {
    let alive = true;
    const provider = getProvider();
    Promise.all([provider.teamApps(), provider.teamMembers()])
      .then(([a, m]) => {
        if (!alive) return;
        setApps(a);
        setMembers(m);
      })
      .catch(() => {
        if (!alive) return;
        setApps([]);
        setMembers([]);
        setTeamError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await getProvider().updateProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim() || null,
      });
      await refreshProfile();
      toast("Profile updated.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="pagehead">
        <div>
          <div className="eyebrow">{profile.accountName ?? "Your team"}</div>
          <h1>Profile</h1>
          <p>Your contact details and your team's VelOps setup.</p>
        </div>
        <div className="spacer" />
        <a className="btn btn--ghost" href={SIGN_OUT_URL}>
          Sign out
        </a>
      </div>

      <div className="detail">
        <div className="card" style={{ padding: "26px 30px 30px" }}>
          <div className="field2">
            <div className="field">
              <label htmlFor="pFirst">First name</label>
              <input id="pFirst" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pLast">Last name</label>
              <input id="pLast" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="pEmail">Email</label>
            <input id="pEmail" type="email" value={profile.email ?? ""} readOnly disabled />
            <span className="hint">Your email is your sign-in and can't be changed here — contact us if it needs updating.</span>
          </div>
          <div className="field">
            <label htmlFor="pPhone">Phone</label>
            <input id="pPhone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+32 ..." />
          </div>
          <div className="formfoot">
            <button type="button" className="btn btn--primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <div>
          <div className="card meta">
            <h3>Your team</h3>
            <dl>
              <div>
                <dt>Team</dt>
                <dd>{profile.accountName ?? "—"}</dd>
              </div>
              <div>
                <dt>Linked apps</dt>
                <dd>
                  {apps === null ? (
                    <Spinner small label="Loading apps" />
                  ) : apps.length === 0 ? (
                    "—"
                  ) : (
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {apps.map((a) => (
                        <OutlinePill key={a.id}>{a.name}</OutlinePill>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
              <div className="sep" />
              <div>
                <dt>Team members</dt>
                <dd>
                  {members === null ? (
                    <Spinner small label="Loading team members" />
                  ) : members.length === 0 ? (
                    "—"
                  ) : (
                    <span style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                      {members.map((m) => (
                        <span key={m.contactId} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span className="userchip__avatar">{initialsOf(m.fullName)}</span>
                          <span>
                            <span className="userchip__name" style={{ display: "block" }}>
                              {m.fullName}
                            </span>
                            {m.email ? (
                              <span className="userchip__org" style={{ display: "block" }}>
                                {m.email}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {teamError ? <p className="hint" style={{ marginTop: 12 }}>Could not load your team details right now.</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
