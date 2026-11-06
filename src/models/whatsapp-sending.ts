import { z } from "zod";
import { commercialEvaluationSchema } from "./commercial-authority";
import { metaAssetsSchema } from "./whatsapp";
import type { MetaAssets } from "./whatsapp";
import { sequenceTimingSchema } from "./email-sequences";

const text = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((v) => !v.includes("\0"));
export const metaPeerSchema = z.string().regex(/^[1-9]\d{6,14}$/);
export const metaPermissionSchema = z.strictObject({
  peer: metaPeerSchema,
  purpose: z.enum(["conversation", "outreach"]),
  opportunityId: z.uuid().nullable(),
  numberProvided: z.literal(true),
  optedIn: z.literal(true),
  noticesReviewed: z.literal(true),
  reference: z.string().regex(/^[A-Z][A-Z0-9-]{5,100}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  observedAt: z.iso.datetime(),
  validUntil: z.iso.datetime(),
});
export type MetaPermission = z.infer<typeof metaPermissionSchema>;
export const metaTemplateSelectionSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9_]{1,512}$/),
  language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/),
  parameters: z
    .array(
      z
        .string()
        .min(1)
        .max(1024)
        .refine((s) => !/[{}\u0000-\u001f]/.test(s)),
    )
    .max(20),
});
export type MetaTemplateSelection = z.infer<typeof metaTemplateSelectionSchema>;
export const metaTemplateSchema = metaTemplateSelectionSchema.extend({
  id: z.string().regex(/^\d{5,40}$/),
  category: z.enum(["MARKETING", "UTILITY"]),
  body: text,
  rendered: text,
});
export type MetaTemplate = z.infer<typeof metaTemplateSchema>;
export const metaPlanSchema = z
  .strictObject({
    campaignId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200),
    connectionVersion: z.number().int().positive(),
    authorityVersion: z.number().int().nonnegative(),
    recipients: z
      .array(
        z.strictObject({
          peer: metaPeerSchema,
          prospectId: z.uuid(),
          contactId: z.string().min(1).max(256),
          evidenceKey: z.string().regex(/^[a-f0-9]{64}$/),
          steps: z
            .array(
              z.strictObject({
                template: metaTemplateSchema,
                delayMinutes: z.number().int().min(0).max(525600),
                evaluation: commercialEvaluationSchema.nullable(),
              }),
            )
            .min(1)
            .max(10),
        }),
      )
      .min(1)
      .max(100)
      .refine((v) => new Set(v.map((r) => r.peer)).size === v.length),
    timing: sequenceTimingSchema,
    notBefore: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    maxAttempts: z.number().int().min(1).max(10),
    stopConditions: z.strictObject({
      reply: z.literal(true),
      optOut: z.literal(true),
      takeover: z.literal(true),
      authorityChange: z.literal(true),
      setupFailure: z.literal(true),
    }),
  })
  .refine((v) =>
    v.recipients.every(
      (r) => r.steps.length <= v.maxAttempts && r.steps[0].delayMinutes === 0,
    ),
  );
export type MetaPlan = z.infer<typeof metaPlanSchema>;
export const metaIntentSchema = z.strictObject({
  actionId: z.uuid(),
  businessId: z.uuid(),
  opportunityId: z.uuid(),
  connectionId: z.uuid(),
  connectionVersion: z.number().int().positive(),
  inboxConnectionId: z.uuid(),
  assets: metaAssetsSchema,
  peer: metaPeerSchema,
  body: text,
  parent: z.string().max(256).nullable(),
  template: metaTemplateSchema.nullable(),
  permissionId: z.uuid(),
  planId: z.uuid().nullable(),
  stepIndex: z.number().int().nonnegative().nullable(),
  reservedAt: z.iso.datetime(),
});
export type MetaIntent = z.infer<typeof metaIntentSchema>;
export const metaSendResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("accepted"),
    messageRef: z.string().regex(/^wamid\.[^\s\u0000-\u001f]{1,250}$/),
    peer: metaPeerSchema,
  }),
  z.strictObject({
    status: z.literal("not_accepted"),
    reason: z.enum([
      "permission_denied",
      "invalid_request",
      "rate_limited",
      "provider_rejected",
    ]),
  }),
  z.strictObject({
    status: z.literal("unknown"),
    reason: z.enum([
      "transport_ambiguous",
      "unsupported_evidence",
      "awaiting_exact_status",
      "invalid_provider_response",
    ]),
  }),
]);
export type MetaSendResult = z.infer<typeof metaSendResultSchema>;
export type MetaOutboundData =
  | { kind: "permission"; permission: MetaPermission }
  | { kind: "revoke_permission"; permissionId: string; reason: string }
  | { kind: "template"; template: MetaTemplate; connectionVersion: number }
  | { kind: "reply_template"; actionId: string; template: MetaTemplate }
  | {
      kind: "plan";
      plan: MetaPlan;
      hash: string;
      sources: MetaCandidate[];
      sender: { number: string; assets: MetaAssets };
    }
  | {
      kind: "decision";
      planId: string;
      hash: string;
      approved: boolean;
      sessionId: string;
      authorityVersion: number;
    }
  | { kind: "intent"; intent: MetaIntent }
  | { kind: "result"; actionId: string; result: MetaSendResult }
  | { kind: "cancel_plan"; planId: string; reason: string }
  | {
      kind: "estimate";
      actionId: string;
      currency: string;
      minor: string;
      reference: string;
      observedAt: string;
      validUntil: string;
    };

export type MetaSendingWorkspace = {
  connectionVersion: number | null;
  authorityVersion: number;
  automation: { remaining: number; unit: string | null; paid: boolean };
  sendingReady: boolean;
  issues: string[];
  workerReady: boolean;
  canApprove: boolean;
  permissions: { id: string; permission: MetaPermission; revoked: boolean }[];
  templates: {
    id: string;
    template: MetaTemplate;
    connectionVersion: number;
    observedAt: string;
  }[];
  plans: {
    id: string;
    plan: MetaPlan;
    hash: string;
    approved: boolean;
    current: boolean;
    cancelled: boolean;
    sender: { number: string; assets: MetaAssets };
    blockedReason: string | null;
    sources: MetaCandidate[];
  }[];
  candidates: MetaCandidate[];
  actions: {
    id: string;
    title: string;
    opportunityId: string;
    state: string;
    reason: string | null;
    dueAt: string;
    intent: MetaIntent | null;
    providerMessageRef: string | null;
    evidence:
      "unresolved" | "accepted" | "sent" | "delivered" | "read" | "failed";
    reconciliationReason: string | null;
  }[];
  usage: {
    actionId: string;
    providerMessageRef: string | null;
    state: "observed_unpriced" | "estimated" | "unpriced";
    currency: string | null;
    minor: string | null;
    provenance: string;
    observedAt: string | null;
    receivedAt: string | null;
    pricing: unknown;
  }[];
  metaPayer: "customer";
  includedInSubscription: false;
  includedInOperatorSpend: false;
};
export type MetaCandidate = {
  prospectId: string;
  contactId: string;
  peer: string;
  name: string;
  evidenceKey: string;
  market: string;
  evidence: unknown;
  sources: {url:string;quote:string;checkedAt:string}[];
};
const candidateSchema=z.object({prospectId:z.uuid(),contactId:z.string(),peer:z.string(),name:z.string(),evidenceKey:z.string(),market:z.string(),evidence:z.unknown(),sources:z.array(z.object({url:z.url(),quote:z.string(),checkedAt:z.iso.datetime()}))});
export const metaSendingWorkspaceSchema: z.ZodType<MetaSendingWorkspace> =
  z.object({
    connectionVersion: z.number().nullable(),
    authorityVersion: z.number(),
    automation: z.object({
      remaining: z.number(),
      unit: z.string().nullable(),
      paid: z.boolean(),
    }),
    sendingReady: z.boolean(),
    issues: z.array(z.string()),
    workerReady: z.boolean(),
    canApprove: z.boolean(),
    permissions: z.array(
      z.object({
        id: z.uuid(),
        permission: metaPermissionSchema,
        revoked: z.boolean(),
      }),
    ),
    templates: z.array(
      z.object({
        id: z.uuid(),
        template: metaTemplateSchema,
        connectionVersion: z.number(),
        observedAt: z.iso.datetime(),
      }),
    ),
    plans: z.array(
      z.object({
        id: z.uuid(),
        plan: metaPlanSchema,
        hash: z.string(),
        approved: z.boolean(),
        current: z.boolean(),
        cancelled: z.boolean(),
        sender: z.object({ number: z.string(), assets: metaAssetsSchema }),
        blockedReason: z.string().nullable(),
        sources:z.array(candidateSchema),
      }),
    ),
    candidates: z.array(candidateSchema),
    actions: z.array(
      z.object({
        id: z.uuid(),
        opportunityId: z.uuid(),
        title: z.string(),
        state: z.string(),
        reason: z.string().nullable(),
        dueAt: z.iso.datetime(),
        intent: metaIntentSchema.nullable(),
        providerMessageRef: z.string().nullable(),
        evidence: z.enum([
          "unresolved",
          "accepted",
          "sent",
          "delivered",
          "read",
          "failed",
        ]),
        reconciliationReason: z.string().nullable(),
      }),
    ),
    usage: z.array(
      z.object({
        actionId: z.uuid(),
        providerMessageRef: z.string().nullable(),
        state: z.enum(["observed_unpriced", "estimated", "unpriced"]),
        currency: z.string().nullable(),
        minor: z.string().nullable(),
        provenance: z.string(),
        observedAt: z.string().nullable(),
        receivedAt: z.string().nullable(),
        pricing: z.unknown(),
      }),
    ),
    metaPayer: z.literal("customer"),
    includedInSubscription: z.literal(false),
    includedInOperatorSpend: z.literal(false),
  });
