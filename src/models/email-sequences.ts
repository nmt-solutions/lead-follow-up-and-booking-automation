import { z } from "zod";
import type { WorkIdentity } from "./discovery";
import type { EmailDispatchAuthorization } from "./email-eligibility";
import { mailObservationSourceSchema } from "./mail-evidence";
import {
  mailReceiptSchema as sequenceReceiptSchema,
  mailAcceptanceSchema,
  type MailDispatchAccess,
} from "./mail-dispatch";

const positive = z.number().int().positive().max(2147483646);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const sequenceTimingSchema = z
  .strictObject({
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        if (/^[+-]/.test(v)) return false;
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((v) => new Set(v).size === v.length),
    startTime: time,
    endTime: time,
    dst: z.literal("compatible"),
    missed: z.literal("next_window"),
  })
  .refine((v) => v.startTime < v.endTime, {
    message: "The local window must end after it starts",
  });
export type SequenceTiming = z.infer<typeof sequenceTimingSchema>;
export const sequencePolicySchema = z
  .strictObject({
    enabled: z.boolean(),
    adapterKey: z.string().min(1).max(120),
    adapterKeys: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(20)
      .refine((v) => new Set(v).size === v.length)
      .optional(),
    mode: z.enum(["fixture", "live"]),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    maxProviderCalls: positive,
    minIntervalSeconds: positive,
    note: z.string().trim().min(1).max(2000),
  })
  .refine((v) => new Date(v.periodEnd) > new Date(v.periodStart));
export type SequencePolicy = z.infer<typeof sequencePolicySchema>;
export const configureSequenceSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  policy: sequencePolicySchema,
});
export const sequenceCommandSchema = z.strictObject({
  runId: z.uuid(),
  expectedVersion: positive,
  command: z.enum(["pause", "cancel", "resume", "recover"]),
  note: z.string().trim().min(1).max(2000),
});
export const classifySequenceReplySchema = z.strictObject({
  runId: z.uuid(),
  observationId: z.uuid(),
  classification: z.enum(["qualifying_inquiry", "other_reply"]),
  note: z.string().trim().min(1).max(2000),
});
export const sequenceWorkSchema = z.strictObject({
  businessId: z.uuid(),
  runId: z.uuid(),
  actionId: z.uuid(),
  generation: positive,
  key: z.uuid(),
  identity: z.strictObject({
    userId: z.string().min(1).max(256),
    sessionId: z.string().min(1).max(256),
  }),
});
export type SequenceWork = z.infer<typeof sequenceWorkSchema>;
export {
  mailReceiptSchema as sequenceReceiptSchema,
  mailResultSchema as sequenceResultSchema,
} from "./mail-dispatch";
export type {
  MailReceipt as SequenceReceipt,
  MailResult as SequenceResult,
} from "./mail-dispatch";
export type SequenceEnvelope = {
  adapterKey: string;
  adapterMode: "fixture" | "live";
  reservedAt: string;
  businessId: string;
  runId: string;
  actionId: string;
  attemptId: string;
  opportunityId: string;
  revisionId: string;
  payloadHash: string;
  stepIndex: number;
  connectionId: string;
  replyConnectionId: string;
  replyInboxId: string;
  recipient: string;
  subject: string;
  body: string;
  fromAddress: string;
  fromName: string;
  replyTo: string;
  platformDisclosure: string;
  internetMessageId: string;
  parent?: { internetMessageId: string; threadRef: string; subject: string };
  emailEligibility: EmailDispatchAuthorization;
};
/** Send performs exactly one bounded transport call, with no internal retry. Message-ID is correlation, never a deduplication promise.
 * Reconcile is read-only. Only authoritative NOT accepted evidence permits a new attempt; search absence is unknown. */
export type SequenceMailProvider = {
  select?(key: string): SequenceMailProvider;
  adapters?: { key: string; mode: "fixture" | "live" | "unconfigured" }[];
  key: string;
  mode: "fixture" | "live" | "unconfigured";
  send(
    envelope: SequenceEnvelope,
    signal: AbortSignal,
    access?: SequenceMailAccess,
  ): Promise<unknown>;
  reconcile(envelope: SequenceEnvelope, signal: AbortSignal): Promise<unknown>;
};
export type SequenceMailAccess = MailDispatchAccess;
export type SequenceQueue = {
  enqueue(work: SequenceWork, dueAt: Date): Promise<string>;
  cancel(runId: string): Promise<void>;
};
export const sequenceActionStates = [
  "waiting",
  "pending",
  "committed",
  "accepted",
  "unknown",
  "failed",
  "paused",
  "cancelled",
] as const;
export type SequenceActionState = (typeof sequenceActionStates)[number];
export const sequenceEventKinds = [
  "prepared",
  "started",
  "paused",
  "resumed",
  "cancelled",
  "attempt_reserved",
  "dispatch_boundary",
  "provider_accepted",
  "provider_accepted_identity_pending",
  "not_accepted",
  "acceptance_unknown",
  "sent_folder_observed",
  "reply_observed",
  "reply_classified",
  "queue_failed",
  "reconciled",
] as const;
export type SequenceEventKind = (typeof sequenceEventKinds)[number];
export const sequenceWorkspaceSchema = z.object({
  adapters: z
    .array(
      z.object({
        key: z.string(),
        mode: z.enum(["fixture", "live", "unconfigured"]),
      }),
    )
    .optional(),
  provider: z.object({
    key: z.string(),
    mode: z.enum(["fixture", "live", "unconfigured"]),
  }),
  queueReady: z.boolean(),
  setupIssues: z.array(z.string()),
  canConfigure: z.boolean(),
  canClassify: z.boolean(),
  policy: z
    .object({ version: positive, configuration: sequencePolicySchema })
    .nullable(),
  usage: z.object({
    reserved: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }),
  runs: z.array(
    z.object({
      id: z.uuid(),
      revisionId: z.uuid(),
      payloadHash: z.string(),
      name: z.string(),
      version: positive,
      state: z.enum(["active", "paused", "cancelled", "completed"]),
      reason: z.string().nullable(),
      progress: z.enum([
        "scheduled",
        "awaiting_reconciliation",
        "needs_review",
        "stopped",
        "completed",
      ]),
      recipients: z.array(
        z.object({
          contactId: z.string(),
          recipient: z.email(),
          opportunityId: z.uuid(),
          actions: z.array(
            z.object({
              id: z.uuid(),
              stepIndex: z.number().int(),
              subject: z.string(),
              body: z.string(),
              state: z.enum(sequenceActionStates),
              reason: z.string().nullable(),
              dueAt: z.iso.datetime().nullable(),
              queueState: z.enum(["none", "pending", "enqueued", "failed"]),
              attempts: z.number().int(),
              receipt: sequenceReceiptSchema.nullable(),
              processingAcceptance: mailAcceptanceSchema.nullable(),
            }),
          ),
        }),
      ),
      history: z.array(
        z.object({
          id: z.uuid(),
          actionId: z.uuid().nullable(),
          kind: z.enum(sequenceEventKinds),
          reason: z.string().nullable(),
          at: z.iso.datetime(),
          actorId: z.string(),
          receipt: sequenceReceiptSchema.nullable(),
          processingAcceptance: mailAcceptanceSchema.nullable(),
          source: mailObservationSourceSchema.nullable(),
          note: z.string().nullable(),
          reviewNeeded: z.boolean(),
          reply: z
            .object({
              subject: z.string(),
              text: z.string(),
              sender: z.string(),
              occurredAt: z.string(),
            })
            .nullable(),
        }),
      ),
    }),
  ),
});
export type SequenceWorkspace = z.infer<typeof sequenceWorkspaceSchema>;
export type SequenceIdentity = WorkIdentity;
