import type { Clock } from "../models/business";
import { type SenderAdapter } from "../models/senders";
import { microsoftTransportKey } from "./transport";

export function createMicrosoftSenderAdapter(d: {
  clock: Clock;
}): SenderAdapter {
  return {
    key: microsoftTransportKey,
    mode: "live",
    async inspect(context) {
      const at = d.clock.now();
      const proof = context.healthProof
        ? {
            ...context.healthProof,
            checks: {
              spf: "pass",
              dkim: "pass",
              dmarc_alignment: "pass",
              health: "pass",
            },
          }
        : null;
      const native =
        context.identity.origin === "customer_mailbox" &&
        context.connection?.configuration.provider === "microsoft" &&
        context.connection.configuration.account ===
          context.identity.fromAddress &&
        context.replyConnection?.configuration.provider === "microsoft";
      return {
        binding: context.binding,
        observedAt: at.toISOString(),
        validUntil: proof?.validUntil ?? at.toISOString(),
        approvedUses:
          native && proof
            ? context.identity.uses.filter(
                (use) =>
                  use === "inbound" ||
                  use === "existing_conversation" ||
                  (use === "first_contact" &&
                    context.identity.purpose === "dedicated_outreach"),
              )
            : [],
        checks: {
          // Current native account/grant and selected reply visibility are additionally checked in identityView and at dispatch.
          identity_control:
            native && context.nativeMicrosoft?.send ? "pass" : "missing",
          domain_verification: "unknown",
          delivery_transport: native ? "pass" : "unavailable",
          sending_grant: context.nativeMicrosoft?.send ? "pass" : "missing",
          reply_reading_grant: context.nativeMicrosoft?.reply
            ? "pass"
            : "missing",
          inbox_sync: context.nativeMicrosoft?.reply ? "pass" : "unavailable",
          reply_capture: context.nativeMicrosoft?.reply ? "pass" : "missing",
          spf: proof?.checks.spf ?? "unknown",
          dkim: proof?.checks.dkim ?? "unknown",
          dmarc_alignment: proof?.checks.dmarc_alignment ?? "unknown",
          health: proof?.checks.health ?? "unknown",
        },
      };
    },
  };
}
