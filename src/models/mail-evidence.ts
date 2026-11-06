import { z } from "zod";
/** Shared provenance for an exact, authorized native mailbox observation. This is not delivery evidence. */
export const mailObservationSourceSchema = z.object({
  provider: z.enum(["gmail", "microsoft"]),
  mailboxId: z.uuid(),
  connectionId: z.uuid(),
  policyVersion: z.number().int().positive(),
  syncGeneration: z.number().int().positive(),
  messageRef: z.string(),
  threadRef: z.string(),
  internetMessageId: z.string(),
  inReplyTo: z.string().nullable(),
  occurredAt: z.iso.datetime({ offset: true }),
});
