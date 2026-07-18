/* ============================================================
   Session context — signed-in portal user + contact profile,
   provided by the AuthGate in App.tsx and consumed by Layout
   and the pages.
   ============================================================ */
import { createContext, useContext } from "react";
import type { PortalUser, Profile } from "./types";

export interface Session {
  user: PortalUser;
  profile: Profile;
  /** Re-fetch the profile (e.g. after updating it). */
  refreshProfile: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession must be used inside the AuthGate.");
  return s;
}
