import { z } from "zod";
import { inspectCampaignSchema } from "./campaigns";
import { mailObservationSourceSchema } from "./mail-evidence";

// #34 owns bounded follow-up execution. Own-client handoff prepares the approved initial message only.
export const prepareHandoffSchema = inspectCampaignSchema.extend({
  stepIndex: z.literal(0),
});
export const handoffRefSchema = z.strictObject({ handoffId: z.uuid() });
export const useHandoffSchema = handoffRefSchema.extend({
  operation: z.enum(["open", "copy_recipient", "copy_subject", "copy_body"]),
});
export const bindHandoffSchema = handoffRefSchema.extend({
  observationId: z.uuid(),
  confirmExactMessage: z.literal(true),
});
export const handoffEvidenceKinds = [
  "prepared",
  "user_marked_sent",
  "sent_folder_observed",
  "reply_observed",
] as const;
export const handoffSourceSchema = mailObservationSourceSchema;
export type HandoffSource = z.infer<typeof handoffSourceSchema>;
export const handoffEvidenceSchema = z.object({
  id: z.uuid(),
  kind: z.enum(handoffEvidenceKinds),
  actorId: z.string(),
  at: z.iso.datetime(),
  source: handoffSourceSchema.nullable(),
});
export const emailHandoffSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  payloadHash: z.string(),
  contactId: z.string(),
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  fromAddress: z.string(),
  at: z.iso.datetime(),
  mailto: z.string(),
  visibility: z.enum(["current", "limited", "unavailable"]),
  evidence: z.array(handoffEvidenceSchema),
  candidates: z.array(
    z.object({
      id: z.uuid(),
      source: handoffSourceSchema,
      subject: z.string(),
      body: z.string(),
    }),
  ),
});
export type EmailHandoff = z.infer<typeof emailHandoffSchema>;
export const handoffWorkspaceSchema = z.object({
  canBind: z.boolean(),
  handoffs: z.array(emailHandoffSchema),
});

/** RFC 6068: only addr-spec, subject and body; encoding happens exactly once. No From, attachments or arbitrary headers. */
export function handoffMailto(
  recipient: string,
  subject: string,
  body: string,
) {
  const address = z.email().max(254).safeParse(recipient);
  if (
    !address.success ||
    !subject.isWellFormed() ||
    !body.isWellFormed() ||
    /[\u0000-\u001f\u007f]/.test(subject) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)
  )
    return null;
  const encode = encodeURIComponent;
  const [local, domain] = recipient.split("@");
  return `mailto:${encode(local)}@${encode(domain)}?subject=${encode(subject)}&body=${encode(body.replace(/\r\n|\r|\n/g, "\r\n"))}`;
}
