import { z } from "zod";
import { paymentSnapshotSchema } from "./subscription-payments";
import { emailActionRefSchema } from "./email-eligibility";
import { businessReportSchema } from "./reporting";
const text = z.string().trim().min(1).max(2000);
const money = z.string().regex(/^\d{1,15}$/);
export const pilotCapabilitySchema = z.enum([
  "discovery",
  "inquiry_email",
  "outreach_email",
  "mailbox",
  "whatsapp",
  "calendar",
]);
export const pilotPlanSchema = z
  .strictObject({
    paymentActionId: z.uuid(),
    goal: text,
    baseline: z
      .array(
        z.strictObject({
          metric: text,
          value: z.number().finite(),
          unit: text,
          evidence: text,
        }),
      )
      .min(1)
      .max(30),
    criteria: z
      .array(
        z.strictObject({
          metric: text,
          comparison: z.enum(["at_least", "at_most"]),
          target: z.number().finite(),
          unit: text,
        }),
      )
      .min(1)
      .max(30),
    scope: text,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    capabilities: z
      .array(pilotCapabilitySchema)
      .min(1)
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    emailActions: z.array(emailActionRefSchema).max(100),
    senderId: z.uuid().nullable(),
    mailboxId: z.uuid().nullable(),
    calendarId: text.nullable(),
    calendarConnectionId: z.uuid().nullable(),
    calendarProvider: z.enum(["google", "microsoft"]).nullable(),
    whatsAppConnectionId: z.uuid().nullable(),
    currency: z.enum(["INR", "USD"]),
    cashLimitMinor: money,
    spendLimitMinor: money,
    timeLimitSeconds: z.number().int().positive().max(31536000),
    ceilings: z.strictObject({
      discovery: z
        .strictObject({
          cashMinor: money,
          spendMinor: money,
          seconds: z.number().int().positive(),
          globalSpendInrMicros: money.nullable(),
          evidence: text,
        })
        .nullable(),
      automation: z
        .strictObject({
          cashMinor: money,
          spendMinor: money,
          seconds: z.number().int().positive(),
          globalSpendInrMicros: money.nullable(),
          evidence: text,
        })
        .nullable(),
      mailbox: z
        .strictObject({
          cashMinor: money,
          spendMinor: money,
          seconds: z.number().int().positive(),
          globalSpendInrMicros: money.nullable(),
          evidence: text,
        })
        .nullable(),
      calendar: z
        .strictObject({
          cashMinor: money,
          spendMinor: money,
          seconds: z.number().int().positive(),
          globalSpendInrMicros: money.nullable(),
          evidence: text,
        })
        .nullable(),
    }),
    approvalEvidence: text,
  })
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt));
export type PilotPlan = z.infer<typeof pilotPlanSchema>;
export const pilotPrepareSchema = z.strictObject({
  requestKey: z.uuid(),
  plan: pilotPlanSchema,
});
export const pilotRefSchema = z.strictObject({
  pilotId: z.uuid(),
  requestKey: z.uuid(),
});
export const pilotSetupSchema = pilotRefSchema.extend({
  mailboxId: z.uuid(),
  maxNativeCalls: z.number().int().min(1).max(100),
  durationSeconds: z.number().int().min(1).max(900),
  evidence: text,
  acceptReadOnlySetup: z.literal(true),
});
export const pilotSetupAuthorizationSchema = z.object({
  input: pilotSetupSchema,
  jobId: z.uuid(),
  mailboxId: z.uuid(),
  mailboxVersion: z.number().int().positive(),
  maxNativeCalls: z.number().int().positive(),
  durationSeconds: z.number().int().positive(),
  expiresAt: z.iso.datetime(),
});
export const pilotGateSchema = z.strictObject({
  capability: z.string(),
  ready: z.boolean(),
  reasons: z.array(z.string()),
  destination: z.string().startsWith("/"),
  checkedAt: z.iso.datetime(),
});
export type PilotGate = z.infer<typeof pilotGateSchema>;
export const pilotEffortSchema = z.strictObject({
  pilotId: z.uuid(),
  requestKey: z.uuid(),
  kind: z.enum(["setup", "support", "sales", "billing_tax", "maintenance"]),
  seconds: z.number().int().positive().max(31536000),
  cashMinor: money,
  spendMinor: money,
  evidence: text,
  occurredAt: z.iso.datetime(),
});
export const pilotResultSchema = z.strictObject({
  pilotId: z.uuid(),
  requestKey: z.uuid(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  contribution: z.strictObject({
    revenueExcludingTaxMinor: money,
    providerExpenseMinor: money,
    effortExpenseMinor: money,
    customerPaidMetaMinor: money.nullable(),
    evidence: z.array(text).min(1),
    complete: z.boolean(),
  }),
  assessment: text,
});
export const pilotReuseSchema = z.strictObject({
  pilotId: z.uuid(),
  requestKey: z.uuid(),
  secondBusinessId: z.uuid(),
  secondPilotId: z.uuid(),
  differentNeed: text,
  reusedConfiguration: z
    .array(z.strictObject({ first: text, second: text, evidence: text }))
    .min(1)
    .max(30),
  adaptations: text,
});
export const pilotEventSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  pilotId: z.uuid(),
  kind: z.enum([
    "prepared",
    "approved",
    "activated",
    "effort",
    "results",
    "renewal",
    "reuse",
    "stopped",
    "setup_authorized",
  ]),
  requestKey: z.uuid(),
  actorId: z.string(),
  at: z.iso.datetime(),
  data: z.record(z.string(), z.unknown()),
});
export type PilotEvent = z.infer<typeof pilotEventSchema>;
export const pilotViewSchema = z.object({
  canRecord: z.boolean(),
  id: z.uuid(),
  businessId: z.uuid(),
  business: z.object({ name: text, offering: text }),
  plan: pilotPlanSchema,
  payment: paymentSnapshotSchema,
  events: z.array(pilotEventSchema),
  gates: z.array(pilotGateSchema),
  status: z.enum([
    "prepared",
    "approved",
    "active",
    "paused",
    "expired",
    "stopped",
    "measured",
    "renewed",
    "reuse_recorded",
  ]),
  usage: z.object({
    cashMinor: money,
    spendMinor: money,
    seconds: z.number().int().nonnegative(),
    unknowns: z.array(z.string()),
  }),
  financialEvidence: z.object({
    accounting: z.object({
      captures: z.array(
        z.object({
          periodId: z.uuid(),
          paymentId: z.string(),
          currency: z.enum(["INR", "USD"]),
          capturedMinor: z.string().nullable(),
          netMinor: z.string().nullable(),
          taxMinor: z.string().nullable(),
          currentlyBlocked: z.boolean(),
        }),
      ),
      adjustments: z.array(
        z.object({
          caseId: z.uuid(),
          kind: z.enum(["refund", "dispute"]),
          status: z.string(),
          currency: z.enum(["INR", "USD"]),
          actualCashMinor: z.string().nullable(),
          issuedCreditMinor: z.string(),
          residualMinor: z.string().nullable(),
          creditDocumentIds: z.array(z.uuid()),
        }),
      ),
    }),
    pilotPaid: z.boolean(),
    renewalPaid: z.boolean(),
    renewal: z
      .object({
        periodId: z.uuid(),
        paymentId: z.string(),
        amountMinor: z.string(),
        paidAt: z.string(),
      })
      .nullable(),
    reasons: z.array(z.string()),
  }),
  report: businessReportSchema.nullable(),
});
export type PilotView = z.infer<typeof pilotViewSchema>;
export const pilotWorkspaceSchema = z.object({
  canRecord: z.boolean(),
  pilots: z.array(pilotViewSchema),
  claims: z.literal(
    "Software records do not establish a real pilot, provider approval, legal review or paid renewal. Native captures and current evidence are required.",
  ),
});
