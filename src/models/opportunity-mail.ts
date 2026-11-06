import { z } from "zod";
import { mailResultSchema, mailAcceptanceSchema } from "./mail-dispatch";
import { mailObservationSourceSchema } from "./mail-evidence";

/** One immutable ordinary reply intent. The commitment ID is also its sole attempt ID.
 * Receipts share the native mail evidence contract with sequences; no new attempt is permitted here. */
export type OpportunityMailEnvelope = {
  actionId: string;
  attemptId: string;
  businessId: string;
  opportunityId: string;
  adapterKey: string;
  adapterMode: "live" | "fixture";
  connectionId: string;
  senderIdentityId: string;
  senderVersion: number;
  senderEvidenceId: string;
  mailboxId: string;
  messageId: string;
  reservedAt: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  platformDisclosure: string;
  recipient: string;
  subject: string;
  body: string;
  internetMessageId: string;
  parent: {
    messageRef: string;
    threadRef: string;
    internetMessageId: string;
    text?: string;
    to?: string[];
  };
};
export const opportunityMailEvidenceSchema = z.strictObject({
  result: mailResultSchema.nullable(),
  processingAcceptance: mailAcceptanceSchema.nullable().optional(),
  sent: mailObservationSourceSchema.nullable(),
});
export type OpportunityMail = z.infer<typeof opportunityMailEvidenceSchema> & {
  envelope: OpportunityMailEnvelope;
};
