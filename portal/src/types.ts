/* ============================================================
   Domain types + status model for the VelOps Support portal.
   All option values follow the getdigit 12269xxxx prefix block;
   statuscodes follow the gd_supportticket state model.
   ============================================================ */

/* ---------- Status constants (gd_supportticket statuscode) ---------- */
export const STATUS = {
  NEW: 1,
  IN_REVIEW: 122690001,
  IN_PROGRESS: 122690002,
  IN_DEVELOPMENT: 122690003,
  WAITING_ON_CUSTOMER: 122690004,
  RESOLVED: 122690005,
  CLOSED: 2, // statecode 1
} as const;
export type StatusCode = (typeof STATUS)[keyof typeof STATUS];

export const STATE = { ACTIVE: 0, INACTIVE: 1 } as const;

/* ---------- Global option sets ---------- */
export const TICKET_TYPE = {
  QUESTION: 122690000,
  COMPLAINT: 122690001,
  BUG: 122690002,
  FEATURE_REQUEST: 122690003,
} as const;
export const TICKET_TYPE_LABEL: Record<number, string> = {
  [TICKET_TYPE.QUESTION]: "Question",
  [TICKET_TYPE.COMPLAINT]: "Complaint",
  [TICKET_TYPE.BUG]: "Bug",
  [TICKET_TYPE.FEATURE_REQUEST]: "Feature request",
};

export const PRIORITY = {
  LOW: 122690000,
  MEDIUM: 122690001,
  HIGH: 122690002,
  CRITICAL: 122690003,
} as const;
export const PRIORITY_LABEL: Record<number, string> = {
  [PRIORITY.LOW]: "Low",
  [PRIORITY.MEDIUM]: "Medium",
  [PRIORITY.HIGH]: "High",
  [PRIORITY.CRITICAL]: "Critical",
};
/** CSS pill class per priority (mockup: pr-low / pr-medium / pr-high / pr-critical). */
export const PRIORITY_TONE: Record<number, string> = {
  [PRIORITY.LOW]: "pr-low",
  [PRIORITY.MEDIUM]: "pr-medium",
  [PRIORITY.HIGH]: "pr-high",
  [PRIORITY.CRITICAL]: "pr-critical",
};

export const SOURCE = {
  PORTAL_FORM: 122690000,
  AI_ASSISTANT: 122690001,
} as const;

export const DIRECTION = {
  CUSTOMER: 122690000,
  VELOPS: 122690001,
} as const;

/* ---------- Status metadata ----------
   4-step tracker per the approved mockup:
   labels ['Submitted','In Review','In Progress','Resolved'],
   stepFor: New->0, In Review->1, In Progress / In Development /
   Waiting on Customer->2, Resolved/Closed->3. When status is
   In Development, step 2 is labelled 'In Development'.
   Resolved/Closed render every step (incl. the last) as done. */
export const TRACKER_STEPS = ["Submitted", "In Review", "In Progress", "Resolved"] as const;

export interface StatusMeta {
  label: string;
  /** CSS pill class (mockup st-* classes). */
  tone: string;
  /** 0-based index into TRACKER_STEPS. */
  step: number;
}

export const STATUS_META: Record<number, StatusMeta> = {
  [STATUS.NEW]: { label: "New", tone: "st-new", step: 0 },
  [STATUS.IN_REVIEW]: { label: "In Review", tone: "st-review", step: 1 },
  [STATUS.IN_PROGRESS]: { label: "In Progress", tone: "st-progress", step: 2 },
  [STATUS.IN_DEVELOPMENT]: { label: "In Development", tone: "st-dev", step: 2 },
  [STATUS.WAITING_ON_CUSTOMER]: { label: "Waiting on Customer", tone: "st-waiting", step: 2 },
  [STATUS.RESOLVED]: { label: "Resolved", tone: "st-resolved", step: 3 },
  [STATUS.CLOSED]: { label: "Closed", tone: "st-closed", step: 3 },
};

export function statusMeta(statuscode: number): StatusMeta {
  return STATUS_META[statuscode] ?? { label: "Unknown", tone: "st-review", step: 0 };
}

/** 0-based tracker step for a statuscode (mirrors the mockup's stepFor). */
export function stepFor(statuscode: number): number {
  return statusMeta(statuscode).step;
}

/** Open = any active status that is not Resolved (mockup OPEN_SET). */
export function isOpen(statuscode: number): boolean {
  return (
    statuscode === STATUS.NEW ||
    statuscode === STATUS.IN_REVIEW ||
    statuscode === STATUS.IN_PROGRESS ||
    statuscode === STATUS.IN_DEVELOPMENT ||
    statuscode === STATUS.WAITING_ON_CUSTOMER
  );
}

export function waitingOnCustomer(statuscode: number): boolean {
  return statuscode === STATUS.WAITING_ON_CUSTOMER;
}

/** Resolved or Closed — the tracker renders fully done. */
export function isSettled(statuscode: number): boolean {
  return statuscode === STATUS.RESOLVED || statuscode === STATUS.CLOSED;
}

/* ---------- Entities ---------- */
export interface Ticket {
  id: string;
  /** Autonumber VEL-xxxxx (gd_ticketnumber). */
  ticketNumber: string;
  subject: string;
  description: string;
  /** gd_tickettype option value. */
  tickettype: number;
  /** gd_ticketpriority option value. */
  priority: number;
  /** gd_ticketsource option value. */
  source: number;
  statecode: number;
  statuscode: number;
  accountId: string | null;
  accountName: string | null;
  contactId: string | null;
  contactName: string | null;
  /** gd_app lookup — the product area. */
  appId: string | null;
  appName: string | null;
  resolutionSummary: string | null;
  satisfactionRating: number | null;
  createdOn: string; // ISO 8601
  modifiedOn: string; // ISO 8601
}

export interface Message {
  id: string;
  ticketId: string;
  title: string;
  body: string;
  /** gd_messagedirection: DIRECTION.CUSTOMER | DIRECTION.VELOPS */
  direction: number;
  authorName: string;
  authorContactId: string | null;
  createdOn: string; // ISO 8601
}

export interface Attachment {
  id: string;
  ticketId: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  isImage: boolean;
  createdOn: string; // ISO 8601
}

/** gd_accountapp junction row, expanded with the app it points to. */
export interface TeamApp {
  /** gd_accountapp id. */
  id: string;
  /** gd_app id — bind new tickets to this. */
  appId: string;
  name: string;
  description: string | null;
}

export interface TeamMember {
  contactId: string;
  fullName: string;
  email: string | null;
}

export interface Profile {
  contactId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  /** parentcustomerid — null while the signup is not yet linked to a team. */
  accountId: string | null;
  accountName: string | null;
}

/** Identity provided by the Power Pages shell. */
export interface PortalUser {
  username: string;
  contactId: string;
}

export interface NewTicketInput {
  subject: string;
  description: string;
  tickettype: number;
  priority: number;
  /** gd_app id from the team's linked apps (optional). */
  appId?: string | null;
  /** gd_source option value; defaults to SOURCE.PORTAL_FORM. */
  source?: number;
}

/** True when a profile is still awaiting team activation (pending gate). */
export function isPending(profile: Profile | null | undefined): boolean {
  return !profile || !profile.accountId;
}

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
