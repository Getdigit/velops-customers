import { describe, expect, it } from "vitest";
import { MockProvider, setMockPending } from "../api/mockProvider";
import { isUnread, latestVelopsMessageOn, markSeen } from "../hooks/useUnread";
import {
  DIRECTION,
  PRIORITY,
  STATE,
  STATUS,
  TICKET_TYPE,
  isOpen,
  isPending,
  isSettled,
  initialsOf,
  statusMeta,
  stepFor,
  waitingOnCustomer,
} from "../types";

describe("status model", () => {
  it("maps every statuscode to the mockup's tracker step", () => {
    expect(stepFor(STATUS.NEW)).toBe(0);
    expect(stepFor(STATUS.IN_REVIEW)).toBe(1);
    expect(stepFor(STATUS.IN_PROGRESS)).toBe(2);
    expect(stepFor(STATUS.IN_DEVELOPMENT)).toBe(2);
    expect(stepFor(STATUS.WAITING_ON_CUSTOMER)).toBe(2);
    expect(stepFor(STATUS.RESOLVED)).toBe(3);
    expect(stepFor(STATUS.CLOSED)).toBe(3);
  });

  it("classifies open / waiting / settled like the mockup filters", () => {
    for (const s of [STATUS.NEW, STATUS.IN_REVIEW, STATUS.IN_PROGRESS, STATUS.IN_DEVELOPMENT, STATUS.WAITING_ON_CUSTOMER]) {
      expect(isOpen(s)).toBe(true);
      expect(isSettled(s)).toBe(false);
    }
    for (const s of [STATUS.RESOLVED, STATUS.CLOSED]) {
      expect(isOpen(s)).toBe(false);
      expect(isSettled(s)).toBe(true);
    }
    expect(waitingOnCustomer(STATUS.WAITING_ON_CUSTOMER)).toBe(true);
    expect(waitingOnCustomer(STATUS.IN_PROGRESS)).toBe(false);
  });

  it("exposes label + tone metadata", () => {
    expect(statusMeta(STATUS.WAITING_ON_CUSTOMER)).toEqual({
      label: "Waiting on Customer",
      tone: "st-waiting",
      step: 2,
    });
    expect(statusMeta(999999).label).toBe("Unknown");
  });

  it("derives initials", () => {
    expect(initialsOf("Emma Peeters")).toBe("EP");
    expect(initialsOf("Digit Support")).toBe("DS");
  });
});

describe("unread logic", () => {
  it("is unread until the ticket is marked seen", () => {
    const latest = new Date().toISOString();
    expect(isUnread("t1", latest)).toBe(true);
    markSeen("t1");
    expect(isUnread("t1", latest)).toBe(false);
  });

  it("never marks tickets without a VelOps reply", () => {
    expect(isUnread("t2", null)).toBe(false);
    expect(latestVelopsMessageOn([])).toBeNull();
  });

  it("picks the newest VelOps message", () => {
    const mk = (direction: number, createdOn: string) => ({
      id: createdOn,
      ticketId: "t",
      title: "",
      body: "",
      direction,
      authorName: "x",
      authorContactId: null,
      createdOn,
    });
    const latest = latestVelopsMessageOn([
      mk(DIRECTION.CUSTOMER, "2026-07-18T10:00:00Z"),
      mk(DIRECTION.VELOPS, "2026-07-15T08:00:00Z"),
      mk(DIRECTION.VELOPS, "2026-07-16T09:00:00Z"),
    ]);
    expect(latest).toBe("2026-07-16T09:00:00Z");
  });
});

describe("MockProvider", () => {
  it("serves the mockup dataset for the signed-in team", async () => {
    const p = new MockProvider();
    const me = await p.myProfile();
    expect(me.fullName).toBe("Emma Peeters");
    expect(me.accountName).toBe("Lotto Cycling Team");
    expect(isPending(me)).toBe(false);

    const apps = await p.teamApps();
    expect(apps).toHaveLength(4);

    const tickets = await p.listTickets();
    expect(tickets.length).toBe(6);
    expect(tickets.map((t) => t.ticketNumber)).toContain("VEL-01042");
  });

  it("creates tickets with the next VEL number and replies flip status", async () => {
    const p = new MockProvider();
    const t = await p.createTicket({
      subject: "Test ticket",
      description: "Something broke",
      tickettype: TICKET_TYPE.BUG,
      priority: PRIORITY.HIGH,
    });
    expect(t.ticketNumber).toBe("VEL-01043");
    expect(t.statuscode).toBe(STATUS.NEW);
    expect(t.statecode).toBe(STATE.ACTIVE);

    const m = await p.createMessage(t.id, "First message");
    expect(m.direction).toBe(DIRECTION.CUSTOMER);
    expect((await p.listMessages(t.id)).map((x) => x.id)).toContain(m.id);

    await p.setStatus(t.id, STATUS.IN_PROGRESS, STATE.ACTIVE);
    expect((await p.getTicket(t.id)).statuscode).toBe(STATUS.IN_PROGRESS);

    await p.rate(t.id, 4);
    expect((await p.getTicket(t.id)).satisfactionRating).toBe(4);
  });

  it("simulates the pending (unlinked) signup via localStorage", async () => {
    setMockPending(true);
    const p = new MockProvider();
    const me = await p.myProfile();
    expect(isPending(me)).toBe(true);
    expect(await p.listTickets()).toHaveLength(0);
    expect(await p.teamApps()).toHaveLength(0);
    setMockPending(false);
  });

  it("searches own tickets by subject and number", async () => {
    const p = new MockProvider();
    expect((await p.searchMyTickets("calendar")).length).toBe(1);
    expect((await p.searchMyTickets("VEL-01027")).length).toBe(1);
    expect((await p.searchMyTickets("")).length).toBe(6);
  });
});
