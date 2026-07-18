import { PRIORITY_LABEL, PRIORITY_TONE, statusMeta } from "../types";

/** Status pill per the mockup (st-* classes). */
export default function StatusPill({ statuscode }: { statuscode: number }) {
  const meta = statusMeta(statuscode);
  return <span className={`pill ${meta.tone}`}>{meta.label}</span>;
}

/** Priority pill per the mockup (pr-* classes). */
export function PriorityPill({ priority }: { priority: number }) {
  const label = PRIORITY_LABEL[priority] ?? "—";
  const tone = PRIORITY_TONE[priority] ?? "pr-low";
  return <span className={`pill ${tone}`}>{label}</span>;
}

/** Neutral outline pill (type / product area). */
export function OutlinePill({ children }: { children: React.ReactNode }) {
  return <span className="pill pill--outline">{children}</span>;
}
