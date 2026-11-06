import { z } from "zod";
import type { MailboxAuthorizationStore } from "./mailbox-authorization";

export const mailReceiptSchema = z.strictObject({
  actionId: z.uuid(),
  attemptId: z.uuid(),
  businessId: z.uuid(),
  connectionId: z.uuid(),
  recipient: z.email(),
  messageRef: z.string().min(1).max(256),
  internetMessageId: z.string().min(1).max(256),
  threadRef: z.string().min(1).max(256),
  acceptedAt: z.iso.datetime(),
  evidence: z.enum(["provider_response", "sent_folder"]).optional(),
});
export type MailReceipt = z.infer<typeof mailReceiptSchema>;
/** Graph's positive empty 202 accepts processing, without a native message/conversation identity. */
export const mailAcceptanceSchema = mailReceiptSchema
  .omit({
    messageRef: true,
    threadRef: true,
    internetMessageId: true,
    evidence: true,
  })
  .extend({
    provider: z.literal("microsoft"),
    evidence: z.literal("provider_response"),
    submittedInternetMessageId: z.string().min(1).max(256),
  });
export type MailAcceptance = z.infer<typeof mailAcceptanceSchema>;
export const mailResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted_pending_identity"),
    acceptance: mailAcceptanceSchema,
  }),
  z.strictObject({
    status: z.literal("accepted"),
    receipt: mailReceiptSchema,
  }),
  z.strictObject({
    status: z.literal("not_accepted"),
    reason: z.enum(["rate_limited", "rejected", "unavailable"]),
    retryAt: z.iso.datetime().nullable(),
  }),
  z.strictObject({ status: z.literal("unknown") }),
]);
export type MailResult = z.infer<typeof mailResultSchema>;
export type MailEnvelope = {
  adapterKey: string;
  adapterMode: "fixture" | "live";
  reservedAt: string;
  businessId: string;
  actionId: string;
  attemptId: string;
  connectionId: string;
  recipient: string;
  subject: string;
  body: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  platformDisclosure: string;
  internetMessageId: string;
};
/** Invocation-local authority under the dispatch lock. Credentials never enter the persisted envelope. */
export type MailDispatchAccess = {
  gmail: Pick<
    MailboxAuthorizationStore,
    "policy" | "grant" | "processingEnabled" | "updateGrant" | "invalidate"
  > | null;
  microsoft?: MailDispatchAccess["gmail"];
  previousReceipt: MailReceipt | null;
  previousSubject: string | null;
  replyParent?: {
    messageRef?: string;
    text?: string;
    to?: string[];
    internetMessageId: string;
    threadRef: string;
    subject: string;
  };
  confirm(): Promise<boolean>;
};
