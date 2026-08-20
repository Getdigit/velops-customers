// One-off: find the Power Pages password-reset e-mails for the test contact and
// print their status + body (the reset link). In this dev environment there is
// no mailbox/server-side sync, so these mails stay in Dataverse on Pending Send
// and never reach the inbox — this fishes the reset link out directly.
//
// Usage (CI): Run Ops Script -> scripts/inspect-reset-mail.mjs

import { api, whoami, fail } from "./lib/dataverse.mjs";

const CONTACT_ID = "d7382d3a-3584-f111-8076-000d3adce9a0";

const STATUS = { 0: "Open/Draft", 1: "Completed", 2: "Canceled", 3: "Sent",
  4: "Received", 5: "Canceled", 6: "Pending Send", 7: "Sending", 8: "Failed" };

try {
  await whoami();

  const res = await api(
    "emails?$select=activityid,subject,description,statuscode,statecode,createdon,torecipients" +
      "&$orderby=createdon desc&$top=10"
  );
  const mails = res.value ?? [];
  console.error(`=== last ${mails.length} e-mail rows in the environment ===`);
  for (const m of mails) {
    console.error(
      `\n--- ${m.createdon}  status=${STATUS[m.statuscode] ?? m.statuscode}  to=${m.torecipients ?? "?"}` +
      `\nsubject: ${m.subject}`
    );
    // Strip HTML tags so the reset URL is easy to copy from the log.
    const text = (m.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    console.error(`body: ${text.slice(0, 1500)}`);
    const links = (m.description ?? "").match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    for (const l of links) console.error(`link: ${l}`);
  }
  if (!mails.length) console.error("No e-mail rows found at all — the portal never created the reset mail.");

  console.log(JSON.stringify({ mails: mails.length }));
} catch (err) {
  fail("inspect-reset-mail failed", err);
}
