import { z } from "zod";
import { commercialEvaluationSchema } from "./commercial-authority";
import type { EmailDispatchAuthorization } from "./email-eligibility";
import type { MailDispatchAccess, MailResult } from "./mail-dispatch";
import type {
  OpportunityMail,
  OpportunityMailEnvelope,
} from "./opportunity-mail";

const note = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((s) => !s.includes("\0"));
const ref = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const controlChangeSchema = z.strictObject({
  command: z.enum(["takeover", "update", "handback"]),
  expectedVersion: z.number().int().min(0).max(2147483646),
  reason: note,
  nextAction: note,
});
export type ControlChange = z.infer<typeof controlChangeSchema>;
export const manualReplySchema = z.strictObject({
  eventId: ref,
  messageRef: ref,
  conversationRef: ref,
  // A persisted received-message reference binds the activity to the current association.
  replyToMessageRef: ref,
  occurredAt: z.iso.datetime({ offset: true }),
  reason: note,
  nextAction: note,
});
export type ManualReply = z.infer<typeof manualReplySchema>;
export type ControlSnapshot = {
  state: "human" | "automation";
  version: number;
  ownerId: string | null;
  reason: string;
  nextAction: string;
  policyVersion: number | null;
};
export type PolicyReview = {
  version: number;
  decisions: Record<string, string>;
  activeConnections: number;
};
export type ControlHistory = {
  id: string;
  command: ControlChange["command"] | "manual_reply" | "inquiry_handoff";
  actorId: string;
  at: string;
  before: ControlSnapshot;
  after: ControlSnapshot;
  sourceRef: string | null;
  policy: PolicyReview | null;
};
export type OpportunityControl = ControlSnapshot & {
  title: string;
  id: string;
  ownerName: string | null;
  history: ControlHistory[];
  actions: DueAction[];
};
export const queueOpportunityActionSchema = z.strictObject({
  messageId: z.uuid(),
  dueAt: z.iso.datetime({ offset: true }),
  evaluation: commercialEvaluationSchema,
});
export type QueueOpportunityAction = z.infer<
  typeof queueOpportunityActionSchema
>;
export type DueAction = {
  id: string;
  state: "pending" | "committed" | "dispatched" | "cancelled";
  reason: string | null;
  dueAt: string;
  email?: Omit<OpportunityMail, "envelope"> | null;
};
export type OpportunityDispatch = {
  email?: OpportunityMailEnvelope;
  emailEligibility?: EmailDispatchAuthorization;
  sender?: {
    identityId: string;
    identityVersion: number;
    fromAddress: string;
    fromName: string;
    replyTo: string;
    platformDisclosure: string;
    evidenceId: string;
    adapterKey: string;
    mode: "unconfigured" | "fixture" | "live";
  };
  actionId: string;
  businessId: string;
  opportunityId: string;
  connectionId: string;
  channel: "email" | "whatsapp";
  evaluation: QueueOpportunityAction["evaluation"] | null;
  reply?: {
    text: string;
    recipientRef: string;
    conversationRef: string;
    replyToMessageRef: string;
    inquiryRunId: string;
  };
};
/** Guarded channel adapter seam. Legacy deterministic/other-channel providers may return void;
 * native mail returns validated acceptance evidence and receives invocation-local locked access.
 * A throw after invocation is ambiguous: committed work is never automatically retried.
 * Implementations must bound/cancel I/O and make one call per committed action. An RFC Message-ID is correlation, not provider deduplication.
 */
export type OpportunityActionProvider = {
  selectEmail?(key: string): OpportunityActionProvider;
  emailIdentity?: { adapterKey: string; mode: "fixture" | "live" };
  channels: readonly ("email" | "whatsapp")[];
  dispatch(
    action: OpportunityDispatch,
    signal: AbortSignal,
    access?: MailDispatchAccess,
  ): Promise<void | MailResult>;
};
