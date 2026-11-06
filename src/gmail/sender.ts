import { z } from "zod";
import type { Clock } from "../models/business";
import { senderCheckSchema, type SenderAdapter } from "../models/senders";
import { gmailSequenceKey } from "./sequence-mail";

/** Operator-owned, attributable verification input. OAuth cannot prove DNS authentication or sender health. */
const evidenceSchema = z
  .array(
    z.strictObject({
      businessId: z.uuid(),
      account: z.email(),
      observedAt: z.iso.datetime(),
      validUntil: z.iso.datetime(),
      reference: z
        .url()
        .max(2000)
        .regex(/^https:\/\//),
      checks: z.strictObject({
        spf: senderCheckSchema,
        dkim: senderCheckSchema,
        dmarc_alignment: senderCheckSchema,
        health: senderCheckSchema,
      }),
    }),
  )
  .max(1000);
export function configuredGmailSenderEvidence(
  env: Readonly<Record<string, string | undefined>>,
) {
  try {
    return evidenceSchema.parse(
      JSON.parse(env.GMAIL_SENDER_EVIDENCE_JSON ?? "[]"),
    );
  } catch {
    return [];
  }
}
export function createGmailSenderAdapter(d: {
  clock: Clock;
  evidence: z.infer<typeof evidenceSchema>;
}): SenderAdapter {
  const evidence = evidenceSchema.parse(d.evidence);
  return {
    key: gmailSequenceKey,
    mode: "live",
    async inspect(context) {
      const at = d.clock.now();
      const proofs = evidence.filter(
        (p) =>
          p.businessId === context.binding.businessId &&
          p.account === context.identity.fromAddress &&
          new Date(p.observedAt) <= at &&
          new Date(p.validUntil) > at,
      );
      const proof = proofs.length === 1 ? proofs[0] : null;
      const native =
        context.identity.origin === "customer_mailbox" &&
        context.connection?.configuration.provider === "gmail" &&
        context.connection.configuration.account ===
          context.identity.fromAddress &&
        context.replyConnection?.configuration.provider === "gmail";
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
        ...(proof ? { verificationReference: proof.reference } : {}),
        checks: {
          // Current native account/grant and selected reply visibility are additionally checked in identityView and at dispatch.
          identity_control:
            native && context.nativeGmail?.send ? "pass" : "missing",
          domain_verification: "unknown",
          delivery_transport: native ? "pass" : "unavailable",
          sending_grant: context.nativeGmail?.send ? "pass" : "missing",
          reply_reading_grant: context.nativeGmail?.reply ? "pass" : "missing",
          inbox_sync: context.nativeGmail?.reply ? "pass" : "unavailable",
          reply_capture: context.nativeGmail?.reply ? "pass" : "missing",
          spf: proof?.checks.spf ?? "unknown",
          dkim: proof?.checks.dkim ?? "unknown",
          dmarc_alignment: proof?.checks.dmarc_alignment ?? "unknown",
          health: proof?.checks.health ?? "unknown",
        },
      };
    },
  };
}
