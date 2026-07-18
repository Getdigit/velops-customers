/* ============================================================
   Pure-logic unit tests for the pages layer: tracker mapping,
   the ticket-list filter predicate, unread logic and the date
   formatting helpers. No DOM rendering needed.
   ============================================================ */
import { describe, expect, it } from "vitest";
import { isUnread, latestVelopsMessageOn, markSeen } from "../../hooks/useUnread";
import type { Message } from "../../types";
import { DIRECTION, STATUS, stepFor } from "../../types";
import { shortDate, timeAgo } from "../format";
import { FILTERS, matchesFilter, matchesSearch } from "../Tickets";

const ALL_STATUSES = [
  STATUS.NEW,
  STATUS.IN_REVIEW,
  STATUS.IN_PROGRESS,
  STATUS.IN_DEVELOPMENT,
  STATUS.WAITING_ON_CUSTOMER,
  STATUS.RESOLVED,
  STATUS.CLOSED,
] as const;

describe("stepFor (4-step tracker)", () => {
  it("maps every statuscode to the mockup's step", () => {
    expect(stepFor(STATUS.NEW)).toBe(0);
    expect(stepFor(STATUS.IN_REVIEW)).toBe(1);
    expect(stepFor(STATUS.IN_PROGRESS)).toBe(2);
    expect(stepFor(STATUS.IN_DEVELOPMENT)).toBe(2);
    expect(stepFor(STATUS.WAITING_ON_CUSTOMER)).toBe(2);
    expect(stepFor(STATUS.RESOLVED)).toBe(3);
    expect(stepFor(STATUS.CLOSED)).toBe(3);
  });

  it("stays within the 4 tracker steps for unknown codes", () => {
    expect(stepFor(999999)).toBeGreaterThanOrEqual(0);
    expect(stepFor(999999)).toBeLessThanOrEqual(3);
  });
});

describe("ticket list filter predicate", () => {
  it("exposes the four mockup chips", () => {
    expect(FILTERS.map((f) => f.key)).toEqual(["all", "open", "waiting", "done"]);
    expect(FILTERS.map((f) => f.label)).toEqual(["All", "Open", "Waiting on you", "Resolved & closed"]);
  });

  it("matches every status under All", () => {
    for (const s of ALL_STATUSES) expect(matchesFilter(s, "all")).toBe(true);
  });

  it("partitions Open vs Resolved & closed exactly (disjoint, exhaustive)", () => {
    const open = ALL_STATUSES.filter((s) => matchesFilter(s, "open"));
    const done = ALL_STATUSES.filter((s) => matchesFilter(s, "done"));
    expect(open).toEqual([
      STATUS.NEW,
      STATUS.IN_REVIEW,
      STATUS.IN_PROGRESS,
      STATUS.IN_DEVELOPMENT,
      STATUS.WAITING_ON_CUSTOMER,
    ]);
    expect(done).toEqual([STATUS.RESOLVED, STATUS.CLOSED]);
    // disjoint + together they cover everything
    for (const s of ALL_STATUSES) {
      expect(matchesFilter(s, "open") !== matchesFilter(s, "done")).toBe(true);
    }
  });

  it("Waiting on you matches only Waiting on Customer", () => {
    for (const s of ALL_STATUSES) {
      expect(matchesFilter(s, "waiting")).toBe(s === STATUS.WAITING_ON_CUSTOMER);
    }
  });

  it("waiting is a subset of open", () => {
    for (const s of ALL_STATUSES) {
      if (matchesFilter(s, "waiting")) expect(matchesFilter(s, "open")).toBe(true);
    }
  });
});

describe("ticket search predicate", () => {
  const t = { subject: "Race calendar not syncing to the Rider App", ticketNumber: "VEL-01042" };

  it("matches subject and ticket number, case-insensitive", () => {
    expect(matchesSearch(t, "calendar")).toBe(true);
    expect(matchesSearch(t, "RIDER app")).toBe(true);
    expect(matchesSearch(t, "vel-01042")).toBe(true);
    expect(matchesSearch(t, "01042")).toBe(true);
    expect(matchesSearch(t, "hotel")).toBe(false);
  });

  it("empty / whitespace query matches everything", () => {
    expect(matchesSearch(t, "")).toBe(true);
    expect(matchesSearch(t, "   ")).toBe(true);
  });
});

describe("unread logic (last-seen vs newest VelOps message)", () => {
  const mk = (direction: number, createdOn: string): Message => ({
    id: createdOn,
    ticketId: "t",
    title: "",
    body: "",
    direction,
    authorName: "x",
    authorContactId: null,
    createdOn,
  });

  it("no VelOps message -> never unread", () => {
    expect(latestVelopsMessageOn([])).toBeNull();
    expect(latestVelopsMessageOn([mk(DIRECTION.CUSTOMER, "2026-07-18T10:00:00Z")])).toBeNull();
    expect(isUnread("tt-none", null)).toBe(false);
  });

  it("unread when the newest VelOps message postdates last-seen", () => {
    const ticketId = "tt-unread";
    markSeen(ticketId, Date.parse("2026-07-15T00:00:00Z"));
    expect(isUnread(ticketId, "2026-07-16T09:00:00Z")).toBe(true);
  });

  it("read when last-seen postdates the newest VelOps message", () => {
    const ticketId = "tt-read";
    markSeen(ticketId, Date.parse("2026-07-17T00:00:00Z"));
    expect(isUnread(ticketId, "2026-07-16T09:00:00Z")).toBe(false);
  });

  it("picks the newest VelOps-authored message, ignoring newer customer ones", () => {
    const latest = latestVelopsMessageOn([
      mk(DIRECTION.VELOPS, "2026-07-15T08:00:00Z"),
      mk(DIRECTION.CUSTOMER, "2026-07-18T10:00:00Z"),
      mk(DIRECTION.VELOPS, "2026-07-16T09:00:00Z"),
    ]);
    expect(latest).toBe("2026-07-16T09:00:00Z");
  });

  it("marking seen now clears the dot", () => {
    const ticketId = "tt-seen-now";
    const latest = new Date().toISOString();
    expect(isUnread(ticketId, latest)).toBe(true);
    markSeen(ticketId);
    expect(isUnread(ticketId, latest)).toBe(false);
  });
});

describe("date formatting helpers", () => {
  const now = new Date("2026-07-18T12:00:00");

  it("shortDate renders 'Jul 14' and adds the year across year boundaries", () => {
    expect(shortDate("2026-07-14T09:12:00", now)).toBe("Jul 14");
    expect(shortDate("2025-12-31T09:12:00", now)).toBe("Dec 31, 2025");
    expect(shortDate("not-a-date", now)).toBe("—");
  });

  it("timeAgo follows the mockup buckets", () => {
    expect(timeAgo("2026-07-18T11:59:30", now)).toBe("Just now");
    expect(timeAgo("2026-07-18T11:30:00", now)).toBe("30 min ago");
    expect(timeAgo("2026-07-18T10:00:00", now)).toBe("2 h ago");
    expect(timeAgo("2026-07-17T09:00:00", now)).toBe("Yesterday");
    expect(timeAgo("2026-07-15T09:00:00", now)).toBe("Jul 15");
    expect(timeAgo("garbage", now)).toBe("—");
  });
});
