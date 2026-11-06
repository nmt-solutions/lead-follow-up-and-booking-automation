import {
  sameSenderBinding,
  senderCheckNames,
  type SenderEvidence,
  type SenderInspection,
  type SenderReadiness,
  type SenderUse,
  type SenderAdapter,
} from "../models/senders";

export const senderCheckLabels = {
  identity_control:
    "Confirm authorized control of this exact From address and Business identification.",
  domain_verification:
    "Verify control of the customer sending domain or subdomain.",
  spf: "Check SPF authentication for the selected sending path.",
  dkim: "Check DKIM authentication for the selected sending path.",
  dmarc_alignment: "Check DMARC alignment with the visible From domain.",
  sending_grant:
    "Authorize sending separately from login and calendar permissions.",
  delivery_transport:
    "Configure and check the selected delivery transport. Domain verification alone cannot deliver mail.",
  reply_reading_grant:
    "Authorize reply reading for the selected reply connection.",
  inbox_sync:
    "Restore synchronization for the selected sales inbox. Imports alone do not establish live synchronization.",
  reply_capture:
    "Check that replies to this route enter the shared sales inbox.",
  health: "Resolve the sender health problem and refresh the connection check.",
} as const;

export function senderReadiness(
  context: SenderInspection,
  evidence: SenderEvidence | null,
  at: Date,
  inboxActive: boolean,
  adapter?: Pick<SenderAdapter, "key" | "mode">,
  mailboxIssues: SenderReadiness["issues"] = [],
): SenderReadiness {
  const { identity, connection, replyRoute, replyConnection } = context;
  const issues: SenderReadiness["issues"] = [...mailboxIssues];
  const issue = (code: string, action: string) => issues.push({ code, action });
  if (adapter?.mode === "unconfigured")
    issue(
      "adapter_unconfigured",
      "Ask the operator to configure the selected mail integration. Delivery and reply capture remain unavailable.",
    );
  else if (
    adapter &&
    evidence &&
    (adapter.key !== evidence.adapterKey || adapter.mode !== evidence.mode)
  )
    issue(
      "adapter_changed",
      "The mail integration changed. Refresh all sender and reply checks with the current connection.",
    );
  if (!identity.enabled)
    issue(
      "identity_disabled",
      "Enable this identity when its setup is complete.",
    );
  if (!connection) issue("connection_required", "Select a sending connection.");
  else {
    if (!connection.configuration.enabled)
      issue(
        "connection_disabled",
        "Enable or reconnect the sending connection.",
      );
    const expected =
      identity.origin === "customer_mailbox"
        ? ["gmail", "microsoft"]
        : [identity.origin];
    if (
      !expected.includes(connection.configuration.provider) ||
      identity.fromAddress !== connection.configuration.account
    )
      issue(
        "connection_mismatch",
        "Select a connection authorized for this exact From address and origin.",
      );
  }
  if (!replyRoute)
    issue(
      "reply_route_required",
      "Select an explicit reply route into the shared sales inbox.",
    );
  else {
    if (
      !replyRoute.configuration.enabled ||
      !replyConnection?.configuration.enabled ||
      !inboxActive
    )
      issue(
        "reply_route_unavailable",
        "Enable the reply route and its selected email inbox and connection.",
      );
    if (
      replyConnection &&
      replyRoute.configuration.address !== replyConnection.configuration.account
    )
      issue(
        "reply_address_mismatch",
        "Use the address authorized by the selected reply connection.",
      );
  }
  if (!evidence)
    issue(
      "observation_required",
      "Check setup after a mail adapter is configured. Saved settings do not establish readiness.",
    );
  else {
    if (!sameSenderBinding(context.binding, evidence.binding))
      issue(
        "observation_outdated",
        "Setup changed. Check this identity again; previous proof cannot authorize the new settings.",
      );
    if (
      new Date(evidence.validUntil) <= at ||
      new Date(evidence.observedAt) > at
    )
      issue(
        "observation_stale",
        "Refresh the expired connection and authentication checks.",
      );
    if (evidence.mode === "unconfigured" && adapter?.mode !== "unconfigured")
      issue(
        "adapter_unconfigured",
        "Configure the selected mail integration before activation.",
      );
    for (const check of senderCheckNames) {
      if (
        check === "domain_verification" &&
        identity.origin !== "customer_domain"
      )
        continue;
      if (evidence.checks[check] !== "pass")
        issue(`${check}:${evidence.checks[check]}`, senderCheckLabels[check]);
    }
  }
  const decision = (use: SenderUse) => {
    const reasons = issues.map((i) => i.code);
    if (!identity.uses.includes(use)) reasons.push("use_not_configured");
    if (!evidence?.approvedUses.includes(use)) reasons.push("use_not_approved");
    if (use === "first_contact") {
      if (identity.origin === "service_provided")
        reasons.push("customer_identity_required");
      if (identity.purpose !== "dedicated_outreach")
        reasons.push("dedicated_outreach_required");
    }
    return { ready: reasons.length === 0, reasons };
  };
  const uses = {
    first_contact: decision("first_contact"),
    trial: decision("trial"),
    inbound: decision("inbound"),
    existing_conversation: decision("existing_conversation"),
  };
  return {
    ready: identity.uses.some((use) => uses[use].ready),
    mode: evidence?.mode ?? "unconfigured",
    issues,
    uses,
  };
}
