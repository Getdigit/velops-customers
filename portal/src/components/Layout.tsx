/* ============================================================
   Portal shell — sticky top bar with logo, section label,
   nav (Tickets / Assistant / Profile), user chip and sign-out.
   Power Pages platform-hosted auth endpoints. Use /SignIn, NOT the
   legacy /Account/Login: the legacy page loads no site css and
   renders unstyled, while /SignIn (and the register flow it links)
   pick up our theme webfiles (portal/platform-theme/theme.css).
     sign in   /SignIn?ReturnUrl=...
     register  /Account/Login/Register  (redirects into the styled flow)
     sign out  /Account/Login/LogOff  (platform sign-out route)
   ============================================================ */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { initialsOf } from "../types";
import VelLogo from "./VelLogo";

export const SIGN_IN_URL = "/SignIn?ReturnUrl=%2Ftickets";
export const REGISTER_URL = "/Account/Login/Register";
export const SIGN_OUT_URL = "/Account/Login/LogOff";

interface LayoutProps {
  /** Signed-in display name (user chip); omit for the public shell. */
  userName?: string | null;
  /** Team name under the user name. */
  orgName?: string | null;
  /** Hide nav links (e.g. pending gate) while keeping the branded bar. */
  showNav?: boolean;
  children: ReactNode;
}

export default function Layout({ userName, orgName, showNav = true, children }: LayoutProps) {
  return (
    <>
      <div className="topbar">
        <div className="topbar__in">
          <VelLogo />
          <div className="topbar__divider" />
          <div className="topbar__label">Support</div>
          <div className="topbar__right">
            {showNav && userName ? (
              <nav className="topnav" aria-label="Main">
                <NavLink to="/tickets" className={({ isActive }) => (isActive ? "is-on" : "")}>
                  Tickets
                </NavLink>
                <NavLink to="/assistant" className={({ isActive }) => (isActive ? "is-on" : "")}>
                  Assistant
                </NavLink>
                <NavLink to="/profile" className={({ isActive }) => (isActive ? "is-on" : "")}>
                  Profile
                </NavLink>
                <a className="signout" href={SIGN_OUT_URL}>
                  Sign out
                </a>
              </nav>
            ) : null}
            {userName ? (
              <div className="userchip">
                <div className="userchip__avatar">{initialsOf(userName)}</div>
                <div>
                  <div className="userchip__name">{userName}</div>
                  {orgName ? <div className="userchip__org">{orgName}</div> : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="wrap">{children}</div>
    </>
  );
}
