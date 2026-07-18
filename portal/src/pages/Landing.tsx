/* ============================================================
   Public landing page — branded hero, pitch and "how it works".
   Signed-in users are sent straight to /tickets; sign-in and
   registration are the platform-hosted Power Pages endpoints.
   ============================================================ */
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getProvider } from "../api/provider";
import Layout, { REGISTER_URL, SIGN_IN_URL } from "../components/Layout";
import Spinner from "../components/Spinner";
import VelLogo from "../components/VelLogo";

const HOW_IT_WORKS = [
  {
    title: "Submit",
    text: "Log a question, complaint, bug or idea — or let our AI assistant capture it for you.",
  },
  {
    title: "Track",
    text: "Every ticket gets a VEL number and a live status tracker, from Submitted to Resolved.",
  },
  {
    title: "Converse",
    text: "Chat with the VelOps team right on the ticket, with screenshots and files attached.",
  },
  {
    title: "Resolve",
    text: "Confirm the fix, rate how we did, and reopen the ticket any time you need it again.",
  },
] as const;

export default function Landing() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let alive = true;
    getProvider()
      .currentUser()
      .then((u) => {
        if (!alive) return;
        setSignedIn(u !== null);
      })
      .catch(() => {
        /* anonymous — stay on the landing page */
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (checking) {
    return (
      <Layout showNav={false}>
        <Spinner label="Loading" />
      </Layout>
    );
  }

  if (signedIn) return <Navigate to="/tickets" replace />;

  return (
    <Layout showNav={false}>
      <div className="hero">
        <VelLogo />
        <div className="hero__eyebrow">Customer Support Portal</div>
        <h1>Support that keeps your team racing</h1>
        <p>
          Questions &amp; complaints about your VelOps environment — log them here, talk directly with
          the VelOps team, and follow every ticket from submitted to resolved.
        </p>
        <div className="hero__actions">
          <a className="btn btn--primary" href={SIGN_IN_URL}>
            Sign in
          </a>
          <a className="btn btn--ghost" href={REGISTER_URL}>
            Create an account
          </a>
        </div>
      </div>

      <div className="how">
        {HOW_IT_WORKS.map((step, i) => (
          <div className="card" key={step.title}>
            <div className="how__num">{i + 1}</div>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </div>
        ))}
      </div>

      <footer>VelOps Support Portal · UI follows VelOps design system v2</footer>
    </Layout>
  );
}
