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
export const mailResultSchema = z.discriminatedUnion("status", [
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
  previousReceipt: MailReceipt | null;
  previousSubject: string | null;
  replyParent?: {
    internetMessageId: string;
    threadRef: string;
    subject: string;
  };
  confirm(): Promise<boolean>;
};
