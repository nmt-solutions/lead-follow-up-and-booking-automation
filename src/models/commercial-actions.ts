import { z } from "zod";
import {
  commercialActionSchema,
  commercialEvaluationResultSchema,
  commercialWorkspaceSchema,
  moneySchema,
} from "./commercial-authority";

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const proposeCommercialSchema = z
  .strictObject({
    requestKey: z.uuid(),
    replacesId: z.uuid().nullable(),
    expectedContextKey: hashSchema,
    mode: z.enum(["manual", "automation"]),
    action: commercialActionSchema,
    messageId: z.uuid(),
    offering: text(200),
    description: text(4000),
    grossAmount: moneySchema,
    discountBps: z.number().int().min(0).max(10000),
    terms: text(4000),
    note: text(1000),
  })
  .superRefine((v, c) => {
    if (
      moneySchema.safeParse(v.grossAmount).success &&
      Number.isInteger(v.discountBps) &&
      (BigInt(v.grossAmount.minor) * BigInt(10000 - v.discountBps)) % 10000n !==
        0n
    )
      c.addIssue({
        code: "custom",
        message:
          "The discount must produce whole minor units; enter an exact amount instead of assuming rounding.",
      });
  });
export type ProposeCommercial = z.infer<typeof proposeCommercialSchema>;
export const commercialPayloadSchema = z.strictObject({
  mode: z.enum(["manual", "automation"]),
  action: commercialActionSchema,
  offering: text(200),
  description: text(4000),
  terms: text(4000),
  grossAmount: moneySchema,
  netAmount: moneySchema,
  discountBps: z.number().int().min(0).max(10000),
  messageId: z.uuid(),
  connectionId: z.uuid(),
  channel: z.enum(["email", "whatsapp"]),
  recipientRef: text(256),
  conversationRef: text(256),
  replyToMessageRef: text(256),
  rfqRevisionId: z.uuid().nullable(),
});
export type CommercialPayload = z.infer<typeof commercialPayloadSchema>;
export const commercialActionRefSchema = z.strictObject({
  actionId: z.uuid(),
  payloadHash: hashSchema,
});
export const decideCommercialSchema = commercialActionRefSchema.extend({
  decision: z.enum(["approved", "rejected"]),
  note: text(1000),
});
export type DecideCommercial = z.infer<typeof decideCommercialSchema>;
export const commercialOutcomeSchema = z.enum([
  "issued_quote",
  "accepted_order",
  "confirmed_sale",
]);
export const commercialEvidenceSchema = commercialActionRefSchema.extend({
  kind: commercialOutcomeSchema,
  reference: text(256),
  occurredAt: z.iso.datetime({ offset: true }),
  note: text(2000),
});
export type CommercialEvidence = z.infer<typeof commercialEvidenceSchema>;
export const commercialProviderResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("failed"),
    reason: z.enum(["rejected", "unavailable"]),
  }),
  z.strictObject({
    status: z.literal("completed"),
    businessId: z.uuid(),
    actionId: z.uuid(),
    payloadHash: hashSchema,
    reference: text(256),
    occurredAt: z.iso.datetime({ offset: true }),
    outcome: commercialOutcomeSchema.nullable(),
  }),
]);
export type CommercialDispatch = {
  businessId: string;
  opportunityId: string;
  actionId: string;
  payloadHash: string;
  payload: CommercialPayload;
};
/** Only a configured adapter is trusted here. No model or inbound event can supply this dependency.
 * One bounded attempt, no internal retries. Failed means definitively no external effect;
 * thrown/invalid/timeout results are ambiguous. Receipt scope must match the exact action.
 */
export type CommercialProvider = {
  key: string;
  available: boolean;
  execute(action: CommercialDispatch, signal: AbortSignal): Promise<unknown>;
};
export const commercialExecutionSchema = z.object({
  state: z.enum(["committed", "completed", "failed", "ambiguous", "blocked"]),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  provider: z.string(),
  at: z.iso.datetime(),
});
export const commercialActionViewSchema = z.object({
  id: z.uuid(),
  seriesId: z.uuid(),
  version: z.number().int(),
  payloadHash: hashSchema,
  payload: commercialPayloadSchema,
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
  policyVersion: z.number().int(),
  contextKey: hashSchema,
  evaluation: commercialEvaluationResultSchema,
  currentEvaluation: commercialEvaluationResultSchema,
  decision: z
    .object({
      decision: z.enum(["approved", "rejected"]),
      actorId: z.string(),
      actorName: z.string(),
      at: z.iso.datetime(),
      note: z.string(),
      policyVersion: z.number().int(),
    })
    .nullable(),
  execution: commercialExecutionSchema.nullable(),
  latest: z.boolean(),
  stale: z.boolean(),
});
export type CommercialActionView = z.infer<typeof commercialActionViewSchema>;
export const commercialWorkspaceSchemaForActions = z.object({
  contextKey: hashSchema,
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  controlState: z.enum(["human", "automation"]),
  canPropose: z.boolean(),
  canApprove: z.boolean(),
  providerAvailable: z.boolean(),
  setupReason: z.string().nullable(),
  authority: commercialWorkspaceSchema,
  offerings: z.array(z.object({ name: z.string(), details: z.string() })),
  messages: z.array(
    z.object({ id: z.uuid(), text: z.string(), recipientRef: z.string() }),
  ),
  actions: z.array(commercialActionViewSchema),
  outcomes: z.array(
    commercialEvidenceSchema.extend({
      id: z.uuid(),
      source: z.string(),
      actorId: z.string(),
      at: z.iso.datetime(),
    }),
  ),
});
export type CommercialActionWorkspace = z.infer<
  typeof commercialWorkspaceSchemaForActions
>;
