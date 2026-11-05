import { z } from "zod";

const reference = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
const content = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !value.includes("\0"));
export const inboxConnectionSchema = z.strictObject({
  label: content(120),
  channel: z.enum(["email", "whatsapp"]),
  // Empty means the entire explicitly selected import connection, never every mailbox.
  conversationRefs: z.array(reference).max(100),
});
export const incomingInquirySchema = z
  .strictObject({
    eventId: reference,
    messageRef: reference,
    conversationRef: reference,
    senderRef: reference,
    senderName: content(200),
    geography: content(200).nullable().default(null),
    kind: z.enum([
      "direct_inquiry",
      "buying_interest_reply",
      "public_signal",
      "other_reply",
    ]),
    replyToMessageRef: reference.optional(),
    subject: content(500),
    text: content(20000),
    occurredAt: z.iso.datetime({ offset: true }),
  })
  .refine(
    (value) =>
      value.kind !== "buying_interest_reply" || !!value.replyToMessageRef,
  );
export type IncomingInquiry = z.infer<typeof incomingInquirySchema>;
export type AddInboxConnection = z.infer<typeof inboxConnectionSchema>;
export type InboxConnection = AddInboxConnection & {
  id: string;
  mode: "normalized_import";
  active: boolean;
  createdAt: string;
};
export type InboxBuyer = {
  id: string;
  name: string;
  senderRef: string;
  geography: string | null;
  relationship: "engaged";
};
export type InboxSummary = {
  id: string;
  subject: string;
  buyerName: string;
  channel: InboxConnection["channel"];
  lastReceivedAt: string;
  opportunityId: string;
};
export type InboxWorkspace = {
  canManage: boolean;
  connections: InboxConnection[];
  conversations: InboxSummary[];
};
export type InboxConversation = {
  id: string;
  subject: string;
  providerRef: string;
  connection: InboxConnection;
  buyer: InboxBuyer;
  opportunity: {
    id: string;
    stage: "inquiry";
    ownerId: string | null;
    handoffReason: string;
    nextAction: string;
    createdAt: string;
  };
  messages: (IncomingInquiry & { id: string; receivedAt: string })[];
};
export type CaptureResult = {
  status: "captured" | "duplicate" | "ignored";
  conversationId: string | null;
};
export type InquiryAdapter = {
  normalize(
    context: { connectionId: string; channel: InboxConnection["channel"] },
    input: unknown,
  ): Promise<unknown>;
};
