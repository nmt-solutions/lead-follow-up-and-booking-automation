import { sameEmailAction } from "../models/email-eligibility";
import type { PilotGate, PilotPlan } from "../models/pilots";
import type { Clock } from "../models/business";
import type { createDiscoveryApplication } from "../application/discovery";
import type { createSenderApplication } from "../application/senders";
import type { createMailboxApplication } from "../application/mailboxes";
import type { createWhatsAppApplication } from "../application/whatsapp";
import type { createGoogleCalendarApplication } from "../application/google-calendar";
import type { createMicrosoftCalendarApplication } from "../application/microsoft-calendar";
import type { createDataGovernanceApplication } from "../application/data-governance";
import type { createEmailEligibilityApplication } from "../application/email-eligibility";
import type { createCommercialAuthorityApplication } from "../application/commercial-authority";
/** Reads current application capabilities. No credential-presence check or customer allow flag becomes approval. */
export function createPilotInspector(d: {
  clock: Clock;
  discovery: Pick<
    ReturnType<typeof createDiscoveryApplication<Headers>>,
    "workspace"
  >;
  senders?: Pick<
    ReturnType<typeof createSenderApplication<Headers>>,
    "workspace"
  >;
  mailboxes?: Pick<
    ReturnType<typeof createMailboxApplication<Headers>>,
    "workspace"
  >;
  whatsapp?: Pick<
    ReturnType<typeof createWhatsAppApplication<Headers>>,
    "workspace"
  >;
  googleCalendar?: Pick<
    ReturnType<typeof createGoogleCalendarApplication>,
    "read"
  >;
  microsoftCalendar?: Pick<
    ReturnType<typeof createMicrosoftCalendarApplication>,
    "read"
  >;
  data: Pick<
    ReturnType<typeof createDataGovernanceApplication<Headers>>,
    "workspace"
  >;
  email?: Pick<
    ReturnType<typeof createEmailEligibilityApplication<Headers>>,
    "workspace" | "evaluate"
  >;
  authority?: Pick<
    ReturnType<typeof createCommercialAuthorityApplication<Headers>>,
    "workspace"
  >;
}) {
  return async (
    c: Headers,
    b: string,
    plan: PilotPlan,
  ): Promise<PilotGate[]> => {
    const result: PilotGate[] = [];
    async function check(
      capability: string,
      destination: string,
      read: () => Promise<string[]>,
    ) {
      try {
        const reasons = await read();
        result.push({
          capability,
          ready: reasons.length === 0,
          reasons,
          destination,
          checkedAt: d.clock.now().toISOString(),
        });
      } catch {
        result.push({
          capability,
          ready: false,
          reasons: [
            "Current authorized setup evidence is unavailable. Open the setup path and resolve access, permissions or configuration.",
          ],
          destination,
          checkedAt: d.clock.now().toISOString(),
        });
      }
    }
    await check("retention", `/businesses/${b}/data`, async () => {
      const s = await d.data.workspace(c, b);
      return s.policy && !s.stopped
        ? []
        : [
            "Configure current reviewed retention, source export/post-cancellation rights and offboarding policy; stopped connections cannot activate a pilot.",
          ];
    });
    if (plan.capabilities.includes("discovery"))
      await check("discovery", `/businesses/${b}/discovery`, async () => {
        const s = await d.discovery.workspace(c, b);
        return [
          ...s.setup,
          ...(!s.policy || !s.brief
            ? [
                "Approve the source scope, market coverage and Business discovery brief.",
              ]
            : []),
          ...(!s.policy?.permissions.retainEvidence ||
          !s.policy.permissions.displayEvidence ||
          !s.policy.permissions.exportEvidence ||
          !s.policy.permissions.afterCancellation
            ? [
                "Executed source scope must cover retained evidence, customer display/export and cancellation; Exa issue #2 completion evidence is required for live activation.",
              ]
            : []),
        ];
      });
    for (const capability of ["inquiry_email", "outreach_email"] as const) {
      if (!plan.capabilities.includes(capability)) continue;
      await check(capability, `/businesses/${b}/senders`, async () => {
        if (!d.senders || !d.authority || !d.email)
          return ["The selected email capability is not configured."];
        const s = await d.senders.workspace(c, b),
          sender = s.identities.find((i) => i.id === plan.senderId),
          use = capability === "outreach_email" ? "first_contact" : "inbound";
        const problems = sender?.readiness.uses[use].ready
          ? []
          : (sender?.readiness.uses[use].reasons ?? [
              "Select and verify the exact sending identity and its reply route.",
            ]);
        const route = s.replyRoutes.find(
          (r) => r.id === sender?.configuration.replyRouteId,
        );
        if (
          !route?.configuration.enabled ||
          route.configuration.inboxConnectionId !== plan.mailboxId ||
          !s.inboxes.some((i) => i.id === plan.mailboxId && i.active)
        )
          problems.push(
            "Select the exact active reply inbox used by this sender; another mailbox does not prove reply visibility.",
          );
        if (sender?.configuration.origin === "customer_mailbox") {
          const mailbox = d.mailboxes
            ? (await d.mailboxes.workspace(c, b)).mailboxes.find(
                (m) => m.id === plan.mailboxId,
              )
            : null;
          if (
            !mailbox ||
            mailbox.visibility !== "current" ||
            !mailbox.lastSyncedAt
          )
            problems.push(
              "The selected native sender needs current synchronization of its exact reply mailbox.",
            );
        }
        const authority = await d.authority.workspace(c, b);
        if (authority.version === 0)
          problems.push(
            "Review current commercial authority and escalation responsibilities.",
          );
        const policies = await d.email.workspace(c, b);
        const selected = policies.actions.filter((a) =>
          plan.emailActions.some((ref) => sameEmailAction(ref, a.action)),
        );
        if (
          selected.length !== plan.emailActions.length ||
          selected.length === 0
        )
          problems.push(
            "Select the actual scoped email actions for fresh recipient, market, purpose, permission and suppression evaluation.",
          );
        for (const action of selected) {
          const evaluated = await d.email.evaluate(c, b, action.action);
          if (evaluated.status !== "allowed")
            problems.push(
              "An exact selected email action has blocked or unknown current eligibility; review Email eligibility.",
            );
        }
        return problems;
      });
    }
    if (plan.capabilities.includes("mailbox"))
      await check("mailbox", `/businesses/${b}/mailboxes`, async () => {
        if (!d.mailboxes)
          return ["The selected mailbox adapter is not configured."];
        const s = await d.mailboxes.workspace(c, b),
          m = s.mailboxes.find((m) => m.id === plan.mailboxId);
        return s.providerMode !== "unconfigured" &&
          m?.visibility === "current" &&
          m.lastSyncedAt
          ? []
          : [
              "Select the exact authorized mailbox scope and restore current reply synchronization. Sending permission or a verified domain does not prove reply visibility.",
            ];
      });
    if (plan.capabilities.includes("whatsapp"))
      await check("whatsapp", `/businesses/${b}/whatsapp`, async () => {
        if (!d.whatsapp)
          return ["The selected Meta adapter is not configured."];
        const s = await d.whatsapp.workspace(c, b);
        return s.connection?.id === plan.whatsAppConnectionId &&
          s.readiness.sendingReady &&
          s.readiness.inboundReady &&
          s.readiness.automationReady
          ? []
          : [
              ...s.readiness.issues,
              "Verify this exact customer-controlled Meta account/number, customer-paid billing, inbound visibility and selected messaging permissions. Meta charges remain separate from operator limits.",
            ];
      });
    if (plan.capabilities.includes("calendar"))
      await check("calendar", `/businesses/${b}/calendar`, async () => {
        if (
          !plan.calendarProvider ||
          !plan.calendarConnectionId ||
          !plan.calendarId
        )
          return [
            "Select the exact calendar provider, account connection and calendar.",
          ];
        const selected =
          plan.calendarProvider === "google"
            ? d.googleCalendar
            : d.microsoftCalendar;
        if (!selected)
          return ["The selected calendar adapter is not configured."];
        const s = await selected.read(c, b);
        return s.configured &&
          s.status === "ready" &&
          s.connectionId === plan.calendarConnectionId &&
          s.selectedCalendarId === plan.calendarId
          ? []
          : [
              "Authorize the selected native calendar path independently of mail. Microsoft personal and work/school accounts retain their supported availability paths. RFQ-only workflows need no calendar.",
            ];
      });
    return result;
  };
}
