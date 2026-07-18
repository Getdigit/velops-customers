import type { ReactNode } from "react";

/** Empty list placeholder, mockup copy by default. */
export default function EmptyState({ children }: { children?: ReactNode }) {
  return <div className="empty">{children ?? "No tickets here. All quiet on this front."}</div>;
}
