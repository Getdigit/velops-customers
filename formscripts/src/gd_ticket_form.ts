/**
 * gd_ticket_form — Form script for the gd_supportticket main form
 * (VelOps Support Hub model-driven app).
 *
 * Behaviour:
 *  - statuscode Resolved (122690005)  → gd_resolutionsummary becomes required;
 *    on any other status the requirement is lifted again.
 *  - statuscode Waiting on Customer (122690004) → INFO form notification
 *    "Waiting on the customer — the ball is in their court."; cleared on any
 *    other status.
 *  - statecode Inactive/Closed (1) → INFO form notification
 *    "This ticket is closed. The customer can reopen it from the portal."
 *
 * Registration (main form, library gd_ticket_form):
 *   OnLoad: GD.TicketForm.onLoad   (pass execution context: true)
 * The OnChange handler for statuscode is wired programmatically in onLoad.
 */

// Status codes — mirror of the VelopsCustomers state model (see docs/PROMPT.md)
const STATUS_WAITING_ON_CUSTOMER = 122690004;
const STATUS_RESOLVED = 122690005;

// statecode 1 = Inactive (Closed). Numeric literal instead of the XrmEnum
// global: esbuild keeps ambient const enums as runtime references and not
// every context exposes XrmEnum.
const STATECODE_INACTIVE = 1;

const WAITING_NOTIFICATION_ID = "gd_ticket_waiting";
const CLOSED_NOTIFICATION_ID = "gd_ticket_closed";

const WAITING_MESSAGE =
  "Waiting on the customer — the ball is in their court.";
const CLOSED_MESSAGE =
  "This ticket is closed. The customer can reopen it from the portal.";

function applyState(formContext: Xrm.FormContext): void {
  const statusAttr =
    formContext.getAttribute<Xrm.Attributes.OptionSetAttribute>("statuscode");
  const stateAttr =
    formContext.getAttribute<Xrm.Attributes.OptionSetAttribute>("statecode");
  const status = statusAttr ? statusAttr.getValue() : null;
  const state = stateAttr ? stateAttr.getValue() : null;

  // Resolution summary is mandatory once the ticket is Resolved.
  const resolutionAttr =
    formContext.getAttribute<Xrm.Attributes.StringAttribute>(
      "gd_resolutionsummary"
    );
  if (resolutionAttr) {
    resolutionAttr.setRequiredLevel(
      status === STATUS_RESOLVED ? "required" : "none"
    );
  }

  // Waiting on Customer banner.
  if (status === STATUS_WAITING_ON_CUSTOMER) {
    formContext.ui.setFormNotification(
      WAITING_MESSAGE,
      "INFO",
      WAITING_NOTIFICATION_ID
    );
  } else {
    formContext.ui.clearFormNotification(WAITING_NOTIFICATION_ID);
  }

  // Closed banner (statecode 1 = Inactive → statuscode 2 Closed).
  if (state === STATECODE_INACTIVE) {
    formContext.ui.setFormNotification(
      CLOSED_MESSAGE,
      "INFO",
      CLOSED_NOTIFICATION_ID
    );
  } else {
    formContext.ui.clearFormNotification(CLOSED_NOTIFICATION_ID);
  }
}

export function onStatusChange(
  executionContext: Xrm.Events.EventContext
): void {
  applyState(executionContext.getFormContext());
}

export function onLoad(executionContext: Xrm.Events.EventContext): void {
  const formContext = executionContext.getFormContext();

  const statusAttr =
    formContext.getAttribute<Xrm.Attributes.OptionSetAttribute>("statuscode");
  if (statusAttr) {
    statusAttr.addOnChange(onStatusChange);
  }

  applyState(formContext);
}

// ── global namespace (Dataverse form scripts must be globally accessible) ─────
declare let window: Window & {
  GD?: { TicketForm?: { onLoad: typeof onLoad; onStatusChange: typeof onStatusChange } };
};

const ns = (window.GD = window.GD ?? {});
ns.TicketForm = { onLoad, onStatusChange };
