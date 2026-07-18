/* ============================================================
   Power Pages shell user context.
   On a live code site the platform injects
   window["Microsoft"].Dynamic365.Portal.User with the signed-in
   user's userName + contactId. Absent (or empty userName) means
   anonymous / local dev.
   ============================================================ */
import type { PortalUser } from "../types";

interface PortalShellUser {
  userName?: string;
  username?: string;
  contactId?: string;
}

interface PortalShell {
  User?: PortalShellUser;
}

export function readPortalUser(): PortalUser | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    Microsoft?: { Dynamic365?: { Portal?: PortalShell } };
  };
  const user = w.Microsoft?.Dynamic365?.Portal?.User;
  if (!user) return null;
  const username = user.userName ?? user.username ?? "";
  const contactId = (user.contactId ?? "").replace(/[{}]/g, "").toLowerCase();
  if (!username || !contactId) return null;
  return { username, contactId };
}

/** True when the Power Pages shell is present at all (even anonymous). */
export function hasPortalShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    Microsoft?: { Dynamic365?: { Portal?: unknown } };
  };
  return !!w.Microsoft?.Dynamic365?.Portal;
}
