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
  // Explicit normalized activity, not a live synchronization claim.
  manualRepliesObservable: z.boolean().default(false),
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
  mode: "normalized_import" | "mailbox";
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
  opportunityId: string | null;
  buyerId: string;
  needsReview: boolean;
};
export type InboxWorkspace = {
  canManage: boolean;
  connections: InboxConnection[];
  conversations: InboxSummary[];
  buyers: InboxBuyer[];
  opportunities: InboxOpportunity[];
  discoverySources: InboxDiscoverySource[];
};
export type InboxConversation = {
  id: string;
  subject: string;
  providerRef: string;
  connection: InboxConnection;
  buyer: InboxBuyer;
  opportunity: InboxOpportunity;
  originalBuyer: InboxBuyer;
  association: {
    version: number;
    defaultOpportunityId: string | null;
    reviewReason: string | null;
    reviewOwnerId: string;
    reviewOwnerName: string;
    nextAction: string;
  };
  opportunities: InboxOpportunity[];
  buyerConversations: InboxSummary[];
  history: AssociationHistory[];
  messages: (IncomingInquiry & {
    id: string;
    receivedAt: string;
    opportunityId: string | null;
  })[];
};
export type InboxOpportunity = {
  id: string;
  buyerId: string;
  title: string;
  stage: "inquiry";
  ownerId: string | null;
  handoffReason: string;
  nextAction: string;
  createdAt: string;
  history: OpportunityHistoryEntry[];
  sources: InboxDiscoverySource[];
};
export type InboxDiscoverySource = {
  observationId: string;
  prospectId: string;
  runId: string;
  name: string;
  matchReason: string;
  uncertainty: string;
  evidence: { url: string; quote: string; checkedAt: string }[];
};
// Read-only history seam: association never authors ownership or conversion outcomes.
export type OpportunityHistoryEntry = {
  id: string;
  kind:
    | "ownership"
    | "booking_request"
    | "confirmed_appointment"
    | "attended_appointment"
    | "quotation_request"
    | "issued_quote"
    | "sale";
  detail: string;
  actorId: string | null;
  sourceRef: string | null;
  at: string;
};
export const associateInquirySchema = z
  .strictObject({
    expectedVersion: z.number().int().min(0).max(2147483646),
    buyerId: z.uuid(),
    messageIds: z
      .array(z.uuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
    allMessages: z.boolean().default(false),
    discoveryObservationId: z.uuid().nullable().default(null),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("existing"), opportunityId: z.uuid() }),
      z.strictObject({ kind: z.literal("new"), title: content(200) }),
      z.strictObject({ kind: z.literal("review") }),
    ]),
    future: z.enum(["keep", "target", "review"]),
    reason: content(1000),
  })
  .refine((value) =>
    value.allMessages
      ? value.messageIds.length === 0
      : value.messageIds.length > 0,
  );
export type AssociateInquiry = z.infer<typeof associateInquirySchema>;
export type AssociationChange = {
  buyerId: string;
  defaultOpportunityId: string | null;
  messages: { id: string; opportunityId: string | null }[];
};
export type AssociationHistory = {
  id: string;
  actorId: string;
  reason: string;
  at: string;
  sourceEventId: string | null;
  discoveryObservationId: string | null;
  before: AssociationChange;
  after: AssociationChange;
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
