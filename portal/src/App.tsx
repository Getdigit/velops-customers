import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { getProvider } from "./api/provider";
import Layout from "./components/Layout";
import PendingGate from "./components/PendingGate";
import Spinner from "./components/Spinner";
import { ToastProvider } from "./components/Toast";
import { SessionContext } from "./session";
import type { PortalUser, Profile } from "./types";
import { isPending } from "./types";

/* Route modules are owned by the pages/ai agents; lazy so the shell
   stays lean and each screen ships as its own chunk. */
const Landing = lazy(() => import("./pages/Landing"));
const Tickets = lazy(() => import("./pages/Tickets"));
const NewTicket = lazy(() => import("./pages/NewTicket"));
const TicketDetail = lazy(() => import("./pages/TicketDetail"));
const AssistantPage = lazy(() => import("./ai/AssistantPage"));
const ProfilePage = lazy(() => import("./pages/Profile"));

/**
 * AuthGate wraps every data route: anonymous users go back to the
 * landing page, signed-in-but-unlinked contacts see the pending
 * gate, linked users get the Layout shell + SessionContext.
 */
function AuthGate() {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PortalUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const refreshProfile = useCallback(async () => {
    const p = await getProvider().myProfile();
    setProfile(p);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const provider = getProvider();
        const u = await provider.currentUser();
        if (!alive) return;
        setUser(u);
        if (u) {
          const p = await provider.myProfile();
          if (!alive) return;
          setProfile(p);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <Layout showNav={false}>
        <Spinner label="Loading" />
      </Layout>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  if (isPending(profile)) {
    return (
      <Layout userName={profile?.fullName || user.username} showNav={false}>
        <PendingGate email={profile?.email ?? user.username} />
      </Layout>
    );
  }

  return (
    <SessionContext.Provider value={{ user, profile: profile!, refreshProfile }}>
      <Layout userName={profile!.fullName || user.username} orgName={profile!.accountName}>
        <Outlet />
      </Layout>
    </SessionContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Suspense
          fallback={
            <div className="loading-full">
              <div className="loading-spinner" />
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route element={<AuthGate />}>
              <Route path="/tickets" element={<Tickets />} />
              <Route path="/tickets/new" element={<NewTicket />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/assistant" element={<AssistantPage />} />
              <Route path="/profile" element={<ProfilePage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}
