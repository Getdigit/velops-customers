/* ============================================================
   MockProvider — in-memory dataset mirroring the approved
   mockup's sample tickets so every page is fully demoable on
   localhost. Mutations (create / reply / status / rating /
   uploads) work against the in-memory store.

   Pending-state simulation: set localStorage
   velops-mock-pending=1 (see setMockPending) to act like a
   signup that is not linked to a team yet.
   ============================================================ */
import type {
  Attachment,
  Message,
  NewTicketInput,
  PortalUser,
  Profile,
  TeamApp,
  TeamMember,
  Ticket,
} from "../types";
import { DIRECTION, PRIORITY, SOURCE, STATE, STATUS, TICKET_TYPE } from "../types";
import type { DataProvider } from "./provider";

export const MOCK_PENDING_KEY = "velops-mock-pending";

/** Simulate the unlinked-signup (pending) state on localhost. */
export function setMockPending(pending: boolean): void {
  if (pending) localStorage.setItem(MOCK_PENDING_KEY, "1");
  else localStorage.removeItem(MOCK_PENDING_KEY);
}

export function isMockPending(): boolean {
  try {
    return localStorage.getItem(MOCK_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

/* ---------------- fixed ids ---------------- */
const ACCOUNT_ID = "a0000000-0000-0000-0000-000000000001";
const ACCOUNT_NAME = "Lotto Cycling Team";
const ME_CONTACT_ID = "c0000000-0000-0000-0000-000000000001";
const ME_NAME = "Emma Peeters";

const APP = {
  RIDER: "0a000000-0000-0000-0000-000000000001",
  HUB: "0a000000-0000-0000-0000-000000000002",
  TRAVEL: "0a000000-0000-0000-0000-000000000003",
  REPORTS: "0a000000-0000-0000-0000-000000000004",
  LICENSING: "0a000000-0000-0000-0000-000000000005",
} as const;

const APP_NAME: Record<string, string> = {
  [APP.RIDER]: "Rider App",
  [APP.HUB]: "Team Hub",
  [APP.TRAVEL]: "Travel & Logistics",
  [APP.REPORTS]: "Reports & Data",
  [APP.LICENSING]: "Account & Licensing",
};

let seq = 0;
function nextId(): string {
  seq += 1;
  return `9${String(seq).padStart(7, "0")}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function sleep(ms = 220): Promise<void> {
  return new Promise((r) => setTimeout(r, ms + Math.random() * 130));
}

/** Tiny inline SVG "screenshot" used for mock image attachments. */
function mockImageDataUrl(label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">` +
    `<rect width="640" height="400" fill="#EEEDE9"/>` +
    `<rect x="24" y="24" width="592" height="64" rx="12" fill="#111111"/>` +
    `<rect x="24" y="112" width="360" height="264" rx="12" fill="#FFFFFF" stroke="#D7D4CC"/>` +
    `<rect x="408" y="112" width="208" height="120" rx="12" fill="#F5D920"/>` +
    `<text x="48" y="64" font-family="sans-serif" font-size="22" fill="#F5D920">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface MockTicket extends Ticket {
  messages: Message[];
  attachments: Attachment[];
}

function msg(
  ticketId: string,
  direction: number,
  authorName: string,
  createdOn: string,
  body: string,
): Message {
  return {
    id: nextId(),
    ticketId,
    title: body.length > 80 ? `${body.slice(0, 77)}...` : body,
    body,
    direction,
    authorName,
    authorContactId: direction === DIRECTION.CUSTOMER && authorName === ME_NAME ? ME_CONTACT_ID : null,
    createdOn,
  };
}

function seedTickets(): MockTicket[] {
  const tickets: MockTicket[] = [];
  const push = (
    t: Omit<
      Ticket,
      | "id"
      | "accountId"
      | "accountName"
      | "source"
      | "resolutionSummary"
      | "description"
      | "contactId"
    > & { description?: string },
    build: (id: string) => { messages: Message[]; attachments?: Attachment[] },
  ) => {
    const id = nextId();
    const parts = build(id);
    tickets.push({
      ...t,
      id,
      description: t.description ?? parts.messages[0]?.body ?? "",
      accountId: ACCOUNT_ID,
      accountName: ACCOUNT_NAME,
      contactId: t.contactName === ME_NAME ? ME_CONTACT_ID : null,
      source: SOURCE.PORTAL_FORM,
      resolutionSummary: null,
      messages: parts.messages,
      attachments: parts.attachments ?? [],
    });
  };

  // VEL-01042 — In Progress, High, Rider App (mockup ticket 1)
  push(
    {
      ticketNumber: "VEL-01042",
      subject: "Race calendar not syncing to the Rider App",
      tickettype: TICKET_TYPE.BUG,
      priority: PRIORITY.HIGH,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.IN_PROGRESS,
      appId: APP.RIDER,
      appName: APP_NAME[APP.RIDER]!,
      contactName: ME_NAME,
      satisfactionRating: null,
      createdOn: "2026-07-14T09:12:00Z",
      modifiedOn: "2026-07-18T08:30:00Z",
    },
    (id) => {
      const m1 = msg(
        id,
        DIRECTION.CUSTOMER,
        ME_NAME,
        "2026-07-14T09:12:00Z",
        "Since Monday the race calendar in the Rider App no longer shows the Vuelta a Burgos stages for our riders. The Team Hub shows them correctly. Riders are asking where they need to be.",
      );
      return {
        messages: [
          m1,
          msg(
            id,
            DIRECTION.VELOPS,
            "Niels S.",
            "2026-07-14T11:40:00Z",
            "Thanks for the report, Emma. Quick check: does this happen for every rider, or only for riders added to the race after last Friday?",
          ),
          msg(
            id,
            DIRECTION.CUSTOMER,
            ME_NAME,
            "2026-07-14T13:05:00Z",
            "Only the two riders we added this week, the rest see the stages fine.",
          ),
          msg(
            id,
            DIRECTION.VELOPS,
            "Niels S.",
            "2026-07-15T08:34:00Z",
            "We found the cause: race bookings created via the new multi-rider selector were saved without a class link, so the app filtered them out. A fix is in progress — we expect to ship it this week. As a workaround, re-adding the two riders individually will make the stages appear immediately.",
          ),
        ],
        attachments: [
          {
            id: nextId(),
            ticketId: id,
            messageId: m1.id,
            fileName: "rider-app-calendar.png",
            mimeType: "image/png",
            isImage: true,
            createdOn: "2026-07-14T09:12:30Z",
          },
        ],
      };
    },
  );

  // VEL-01041 — Waiting on Customer, Medium, Team Hub
  push(
    {
      ticketNumber: "VEL-01041",
      subject: "How do I add a new soigneur to the staff list?",
      tickettype: TICKET_TYPE.QUESTION,
      priority: PRIORITY.MEDIUM,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.WAITING_ON_CUSTOMER,
      appId: APP.HUB,
      appName: APP_NAME[APP.HUB]!,
      contactName: "Marta Kovacs",
      satisfactionRating: null,
      createdOn: "2026-07-13T15:20:00Z",
      modifiedOn: "2026-07-17T09:00:00Z",
    },
    (id) => ({
      messages: [
        msg(
          id,
          DIRECTION.CUSTOMER,
          "Marta Kovacs",
          "2026-07-13T15:20:00Z",
          "We hired a new soigneur starting August 1. Where do I add her so she shows up in the staff planning and can be booked for races?",
        ),
        msg(
          id,
          DIRECTION.VELOPS,
          "Digit Support",
          "2026-07-13T16:02:00Z",
          "Welcome aboard to her! You add her under Team Hub → Staff → New. One thing we need to know: should she also get access to the app herself (VelOps Crew licence), or is planning-only enough for now?",
        ),
      ],
    }),
  );

  // VEL-01039 — In Development, Medium, Travel & Logistics
  push(
    {
      ticketNumber: "VEL-01039",
      subject: "Hotel details missing from travel booking export",
      tickettype: TICKET_TYPE.COMPLAINT,
      priority: PRIORITY.MEDIUM,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.IN_DEVELOPMENT,
      appId: APP.TRAVEL,
      appName: APP_NAME[APP.TRAVEL]!,
      contactName: ME_NAME,
      satisfactionRating: null,
      createdOn: "2026-07-10T10:44:00Z",
      modifiedOn: "2026-07-15T09:00:00Z",
    },
    (id) => ({
      messages: [
        msg(
          id,
          DIRECTION.CUSTOMER,
          ME_NAME,
          "2026-07-10T10:44:00Z",
          "The Excel export of travel bookings no longer contains the hotel column. Our bus driver relies on that list — this is the second race where we had to look everything up manually. Not great.",
        ),
        msg(
          id,
          DIRECTION.VELOPS,
          "Niels S.",
          "2026-07-10T12:15:00Z",
          "You're right, and sorry for the hassle — the hotel column was dropped in the last export rework. We're treating this as a regression. It's scheduled for the current development sprint; I'll update this ticket the moment it ships.",
        ),
      ],
    }),
  );

  // VEL-01036 — In Review, Low, Travel & Logistics (feature request)
  push(
    {
      ticketNumber: "VEL-01036",
      subject: "Feature request: weekly logistics digest email",
      tickettype: TICKET_TYPE.FEATURE_REQUEST,
      priority: PRIORITY.LOW,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.IN_REVIEW,
      appId: APP.TRAVEL,
      appName: APP_NAME[APP.TRAVEL]!,
      contactName: "Marta Kovacs",
      satisfactionRating: null,
      createdOn: "2026-07-07T17:31:00Z",
      modifiedOn: "2026-07-08T09:10:00Z",
    },
    (id) => ({
      messages: [
        msg(
          id,
          DIRECTION.CUSTOMER,
          "Marta Kovacs",
          "2026-07-07T17:31:00Z",
          "Idea: a weekly email every Sunday evening with all logistics for the coming week (races, travel, vehicles, hotels). Would save our staff a lot of clicking.",
        ),
        msg(
          id,
          DIRECTION.VELOPS,
          "Niels S.",
          "2026-07-08T09:10:00Z",
          "Nice one — logged as a feature request. We're reviewing it for the roadmap; you'll see the status here change to “In Development” if it gets scheduled.",
        ),
      ],
    }),
  );

  // VEL-01031 — Resolved, Critical, Reports & Data
  push(
    {
      ticketNumber: "VEL-01031",
      subject: "Cannot upload medical test results (PDF over 10 MB)",
      tickettype: TICKET_TYPE.BUG,
      priority: PRIORITY.CRITICAL,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.RESOLVED,
      appId: APP.REPORTS,
      appName: APP_NAME[APP.REPORTS]!,
      contactName: "Dr. Elise Vandamme",
      satisfactionRating: null,
      createdOn: "2026-07-02T08:15:00Z",
      modifiedOn: "2026-07-04T14:30:00Z",
    },
    (id) => {
      const m1 = msg(
        id,
        DIRECTION.CUSTOMER,
        "Dr. Elise Vandamme",
        "2026-07-02T08:15:00Z",
        "Uploading the lab PDFs for the pre-Tour medical tests fails with a timeout. Files are around 12 MB. We need these in the system before Thursday's UCI deadline.",
      );
      return {
        messages: [
          m1,
          msg(
            id,
            DIRECTION.VELOPS,
            "Niels S.",
            "2026-07-02T08:52:00Z",
            "Understood — treating this as critical given the deadline. Investigating now.",
          ),
          msg(
            id,
            DIRECTION.VELOPS,
            "Niels S.",
            "2026-07-04T14:30:00Z",
            "Fixed: the file size limit on medical attachments has been raised to 50 MB and the upload no longer times out on slower connections. Your 12 MB files upload fine in our test. Could you confirm on your side?",
          ),
        ],
        attachments: [
          {
            id: nextId(),
            ticketId: id,
            messageId: m1.id,
            fileName: "lab-results-sample.pdf",
            mimeType: "application/pdf",
            isImage: false,
            createdOn: "2026-07-02T08:16:00Z",
          },
        ],
      };
    },
  );

  // VEL-01027 — Closed, Low, Account & Licensing, rated 5
  push(
    {
      ticketNumber: "VEL-01027",
      subject: "Question about invoice for extra rider licences",
      tickettype: TICKET_TYPE.QUESTION,
      priority: PRIORITY.LOW,
      statecode: STATE.INACTIVE,
      statuscode: STATUS.CLOSED,
      appId: APP.LICENSING,
      appName: APP_NAME[APP.LICENSING]!,
      contactName: ME_NAME,
      satisfactionRating: 5,
      createdOn: "2026-06-26T11:02:00Z",
      modifiedOn: "2026-06-27T09:18:00Z",
    },
    (id) => ({
      messages: [
        msg(
          id,
          DIRECTION.CUSTOMER,
          ME_NAME,
          "2026-06-26T11:02:00Z",
          "We added three stagiaires in June — will the extra VelOps Rider licences be prorated on the next invoice?",
        ),
        msg(
          id,
          DIRECTION.VELOPS,
          "Digit Support",
          "2026-06-27T09:18:00Z",
          "Yes — licences added mid-quarter are prorated per started month. The three stagiaires will appear on the Q3 invoice for July–September. Full details are in your agreement, section 4.",
        ),
      ],
    }),
  );

  return tickets;
}

/* ---------------- provider ---------------- */
export class MockProvider implements DataProvider {
  private tickets: MockTicket[] = seedTickets();
  private nextNumber = 1043;
  /** Mock attachment id -> url (data URI for seeds, object URL for uploads). */
  private fileUrls = new Map<string, string>();

  constructor() {
    for (const t of this.tickets) {
      for (const a of t.attachments) {
        this.fileUrls.set(
          a.id,
          a.isImage
            ? mockImageDataUrl(a.fileName)
            : `data:application/pdf;base64,` /* stub download for non-images */,
        );
      }
    }
  }

  private profile(): Profile {
    const pending = isMockPending();
    return {
      contactId: ME_CONTACT_ID,
      firstName: "Emma",
      lastName: "Peeters",
      fullName: ME_NAME,
      email: "emma.peeters@lottocycling.example",
      phone: "+32 470 12 34 56",
      jobTitle: "Team Operations Manager",
      accountId: pending ? null : ACCOUNT_ID,
      accountName: pending ? null : ACCOUNT_NAME,
    };
  }

  private find(ticketId: string): MockTicket {
    const t = this.tickets.find((x) => x.id === ticketId);
    if (!t) throw new Error(`Ticket ${ticketId} not found.`);
    return t;
  }

  async currentUser(): Promise<PortalUser | null> {
    await sleep(80);
    return { username: "emma.peeters@lottocycling.example", contactId: ME_CONTACT_ID };
  }

  async myProfile(): Promise<Profile> {
    await sleep();
    return this.profile();
  }

  async teamApps(): Promise<TeamApp[]> {
    await sleep();
    if (isMockPending()) return [];
    // 4 apps linked to Lotto Cycling Team via gd_accountapp
    return [APP.RIDER, APP.HUB, APP.TRAVEL, APP.REPORTS].map((appId, i) => ({
      id: `aa00000${i}-0000-0000-0000-00000000000${i}`,
      appId,
      name: APP_NAME[appId]!,
      description: null,
    }));
  }

  async teamMembers(): Promise<TeamMember[]> {
    await sleep();
    if (isMockPending()) return [];
    return [
      { contactId: ME_CONTACT_ID, fullName: ME_NAME, email: "emma.peeters@lottocycling.example" },
      { contactId: "c0000000-0000-0000-0000-000000000002", fullName: "Marta Kovacs", email: "marta.kovacs@lottocycling.example" },
      { contactId: "c0000000-0000-0000-0000-000000000003", fullName: "Dr. Elise Vandamme", email: "elise.vandamme@lottocycling.example" },
    ];
  }

  async listTickets(): Promise<Ticket[]> {
    await sleep();
    if (isMockPending()) return [];
    return [...this.tickets]
      .sort((a, b) => b.modifiedOn.localeCompare(a.modifiedOn))
      .map(({ messages: _m, attachments: _a, ...t }) => t);
  }

  async getTicket(id: string): Promise<Ticket> {
    await sleep();
    const { messages: _m, attachments: _a, ...t } = this.find(id);
    return t;
  }

  async listMessages(ticketId: string): Promise<Message[]> {
    await sleep();
    return [...this.find(ticketId).messages].sort((a, b) => a.createdOn.localeCompare(b.createdOn));
  }

  async listAttachments(ticketId: string): Promise<Attachment[]> {
    await sleep();
    return [...this.find(ticketId).attachments];
  }

  async createTicket(input: NewTicketInput): Promise<Ticket> {
    await sleep(350);
    const me = this.profile();
    if (!me.accountId) throw new Error("Your account is not linked to a team yet.");
    const id = nextId();
    const now = new Date().toISOString();
    const t: MockTicket = {
      id,
      ticketNumber: `VEL-0${this.nextNumber++}`,
      subject: input.subject,
      description: input.description,
      tickettype: input.tickettype,
      priority: input.priority,
      source: input.source ?? SOURCE.PORTAL_FORM,
      statecode: STATE.ACTIVE,
      statuscode: STATUS.NEW,
      accountId: me.accountId,
      accountName: me.accountName,
      contactId: me.contactId,
      contactName: me.fullName,
      appId: input.appId ?? null,
      appName: input.appId ? (APP_NAME[input.appId] ?? null) : null,
      resolutionSummary: null,
      satisfactionRating: null,
      createdOn: now,
      modifiedOn: now,
      messages: [],
      attachments: [],
    };
    this.tickets.unshift(t);
    return this.getTicket(id);
  }

  async createMessage(ticketId: string, body: string): Promise<Message> {
    await sleep(250);
    const t = this.find(ticketId);
    const m = msg(ticketId, DIRECTION.CUSTOMER, ME_NAME, new Date().toISOString(), body);
    t.messages.push(m);
    t.modifiedOn = m.createdOn;
    return m;
  }

  async uploadAttachment(ticketId: string, file: File, messageId?: string): Promise<Attachment> {
    await sleep(400);
    const t = this.find(ticketId);
    const a: Attachment = {
      id: nextId(),
      ticketId,
      messageId: messageId ?? null,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      isImage: file.type.startsWith("image/"),
      createdOn: new Date().toISOString(),
    };
    this.fileUrls.set(a.id, URL.createObjectURL(file));
    t.attachments.push(a);
    t.modifiedOn = a.createdOn;
    return a;
  }

  attachmentUrl(a: Attachment): string {
    return this.fileUrls.get(a.id) ?? mockImageDataUrl(a.fileName);
  }

  async setStatus(ticketId: string, statuscode: number, statecode: number): Promise<void> {
    await sleep(200);
    const t = this.find(ticketId);
    t.statuscode = statuscode;
    t.statecode = statecode;
    t.modifiedOn = new Date().toISOString();
  }

  async rate(ticketId: string, rating: number): Promise<void> {
    await sleep(150);
    const t = this.find(ticketId);
    t.satisfactionRating = rating;
  }

  async updateProfile(_patch: Partial<Profile>): Promise<void> {
    await sleep(250);
    // Mock profile is static; a real PATCH happens in PortalProvider.
  }

  async searchMyTickets(q: string): Promise<Ticket[]> {
    const needle = q.trim().toLowerCase();
    const all = await this.listTickets();
    if (!needle) return all;
    return all.filter((t) => `${t.subject} ${t.ticketNumber}`.toLowerCase().includes(needle));
  }
}
