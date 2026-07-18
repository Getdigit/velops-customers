/* ============================================================
   DataProvider — the single seam between the UI and its data.
   PortalProvider talks to the Power Pages Web API (/_api);
   MockProvider serves the mockup dataset for localhost dev.
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
import { hasPortalShell } from "./user";
import { PortalProvider } from "./portalProvider";
import { MockProvider } from "./mockProvider";

export interface DataProvider {
  /** Signed-in portal user, or null when anonymous. */
  currentUser(): Promise<PortalUser | null>;
  /** The signed-in contact's profile (accountId null => pending gate). */
  myProfile(): Promise<Profile>;
  /** Apps linked to the user's team (gd_accountapp expanded with gd_app). */
  teamApps(): Promise<TeamApp[]>;
  /** Contacts linked to the user's team. */
  teamMembers(): Promise<TeamMember[]>;
  /** All tickets visible to this user (account-scoped), newest activity first. */
  listTickets(): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket>;
  /** Public thread of a ticket, oldest first. */
  listMessages(ticketId: string): Promise<Message[]>;
  listAttachments(ticketId: string): Promise<Attachment[]>;
  /** Creates the ticket (status New; source defaults to Portal form). */
  createTicket(input: NewTicketInput): Promise<Ticket>;
  /** Adds a customer message to the thread. */
  createMessage(ticketId: string, body: string): Promise<Message>;
  /** Creates a gd_ticketattachment row and uploads the file column. */
  uploadAttachment(ticketId: string, file: File, messageId?: string): Promise<Attachment>;
  /** URL to download / inline-render an attachment's file. */
  attachmentUrl(a: Attachment): string;
  /** Status transition (pages own the transition rules). */
  setStatus(ticketId: string, statuscode: number, statecode: number): Promise<void>;
  /** 1-5 satisfaction rating on a resolved ticket. */
  rate(ticketId: string, rating: number): Promise<void>;
  updateProfile(patch: Partial<Profile>): Promise<void>;
  /** Search own tickets by text (subject + ticket number). */
  searchMyTickets(q: string): Promise<Ticket[]>;
}

let instance: DataProvider | null = null;

/**
 * PortalProvider on a real Power Pages site (shell present) and in
 * production builds; MockProvider during localhost dev.
 */
export function getProvider(): DataProvider {
  if (!instance) {
    instance = hasPortalShell() || import.meta.env.PROD ? new PortalProvider() : new MockProvider();
  }
  return instance;
}

/** Test seam. */
export function setProvider(p: DataProvider | null): void {
  instance = p;
}
