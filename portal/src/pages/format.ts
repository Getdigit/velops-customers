/* ============================================================
   Pure date-formatting helpers for the pages — the mockup shows
   "2 h ago" / "Yesterday" / "Jul 15" style timestamps.
   ============================================================ */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jul 14" (adds the year when it differs from `now`'s year). */
export function shortDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "Jul 14, 09:12" — message timestamps in the thread. */
export function dateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${shortDate(iso, now)}, ${hh}:${mm}`;
}

/** Relative "updated" label per the mockup: Just now / X min ago / X h ago / Yesterday / Jul 15. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 90 * 1000) return "Just now";
  const mins = Math.round(diffMs / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 3600 * 1000);
  if (d >= startOfYesterday && d < startOfToday) return "Yesterday";
  return shortDate(iso, now);
}
