import { z } from "zod";
import { taxRuleSchema } from "./tax";
import { paymentSnapshotSchema } from "./subscription-payments";
import { taxCalculationSchema } from "./tax";

const text = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v));
const version = z.number().int().min(0).max(2147483646);
const series = z.strictObject({
  key: z.string().regex(/^[a-z0-9-]{1,80}$/),
  prefix: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
  first: z.string().regex(/^[1-9][0-9]{0,14}$/),
  width: z.number().int().min(1).max(18),
});
export const issuerConfigurationSchema = z
  .strictObject({
    mode: z.enum(["fixture", "live"]),
    effectiveFrom: z.iso.datetime(),
    effectiveUntil: z.iso.datetime().nullable(),
    seller: z.strictObject({
      legalName: text,
      address: text,
      country: z.string().regex(/^[A-Z]{2}$/),
      contact: text,
    }),
    legalFields: z
      .array(z.strictObject({ label: text, value: text }))
      .min(1)
      .max(40),
    requiredCustomerFields: z
      .array(
        z.enum([
          "legalName",
          "address",
          "invoiceContact",
          "registrationNumber",
          "taxIdentifiers",
        ]),
      )
      .min(1)
      .max(5),
    series: z.strictObject({ invoice: series, credit_note: series }),
    currencies: z
      .array(
        z.strictObject({
          currency: z.enum(["INR", "USD"]),
          precision: z.literal(2),
          rounding: taxRuleSchema.shape.rounding,
          additionalRoundings: z.array(taxRuleSchema.shape.rounding).max(23),
        }),
      )
      .min(1)
      .max(2),
    template: z.strictObject({
      format: z.literal("text_v1"),
      invoiceTitle: text,
      creditTitle: text,
      footer: text,
    }),
    retention: z.strictObject({
      minimumSeconds: z.number().int().positive().max(2147483647),
      policyReference: text,
      disposition: z.literal("protected_history"),
    }),
    creditAllocation: z.literal("cumulative_original_components_v1"),
    evidence: z
      .array(
        z.strictObject({
          title: text,
          reference: text,
          checkedAt: z.iso.datetime(),
        }),
      )
      .min(1)
      .max(20),
  })
  .superRefine((v, ctx) => {
    if (
      v.effectiveUntil &&
      new Date(v.effectiveUntil) <= new Date(v.effectiveFrom)
    )
      ctx.addIssue({ code: "custom", message: "End must follow start" });
    if (
      v.series.invoice.key === v.series.credit_note.key ||
      v.series.invoice.prefix === v.series.credit_note.prefix
    )
      ctx.addIssue({ code: "custom", message: "Use distinct series" });
    if (
      new Set(v.currencies.map((c) => c.currency)).size !== v.currencies.length
    )
      ctx.addIssue({ code: "custom", message: "Use distinct currencies" });
  });
export const saveIssuerSchema = z.strictObject({
  expectedVersion: version,
  configuration: issuerConfigurationSchema,
  note: text,
});
export const decideIssuerSchema = z.strictObject({
  revisionId: z.uuid(),
  expectedVersion: version,
  outcome: z.enum(["approved", "withdrawn"]),
  note: text,
});
export type IssuerConfiguration = z.infer<typeof issuerConfigurationSchema>;
export type SaveIssuer = z.infer<typeof saveIssuerSchema>;
export type DecideIssuer = z.infer<typeof decideIssuerSchema>;
export const issuerRevisionSchema = z.object({
  id: z.uuid(),
  version,
  configuration: issuerConfigurationSchema,
  actorId: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});
export const issuerDecisionSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  version,
  outcome: z.enum(["approved", "withdrawn"]),
  actorId: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});
export const issuerCatalogSchema = z.object({
  revisions: z.array(issuerRevisionSchema),
  decisions: z.array(issuerDecisionSchema),
});
export type IssuerCatalog = z.infer<typeof issuerCatalogSchema>;
export const issueDocumentSchema = z.strictObject({
  periodId: z.uuid(),
  requestKey: z.uuid(),
});
export type IssueDocument = z.infer<typeof issueDocumentSchema>;
export const adjustDocumentSchema = z
  .strictObject({
    invoiceId: z.uuid(),
    periodId: z.uuid(),
    paymentId: z.string().min(1).max(200),
    requestKey: z.uuid(),
    adjustmentId: z.uuid(),
    source: z.strictObject({
      kind: z.enum(["manual", "refund", "dispute"]),
      reference: text,
    }),
    reason: text,
    evidence: z.array(text).min(1).max(20),
    lines: z
      .array(
        z.strictObject({
          lineId: z.string().min(1).max(200),
          netMinor: z.string().regex(/^[1-9][0-9]{0,59}$/),
        }),
      )
      .min(1)
      .max(40),
  })
  .refine(
    (v) => new Set(v.lines.map((l) => l.lineId)).size === v.lines.length,
    "Use distinct lines",
  );
export type AdjustDocument = z.infer<typeof adjustDocumentSchema>;
const issuerSnapshotSchema = z.object({
  revision: issuerRevisionSchema,
  approval: issuerDecisionSchema,
});
export const documentSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.object({
    periodId: z.uuid(),
    actionId: z.uuid(),
    paymentId: z.string(),
    provider: z.string(),
    account: z.string(),
    start: z.iso.datetime(),
    end: z.iso.datetime(),
  }),
  financial: paymentSnapshotSchema,
  issuer: issuerSnapshotSchema,
  currency: z.enum(["INR", "USD"]),
  precision: z.literal(2),
  lines: taxCalculationSchema.shape.lines,
  totals: taxCalculationSchema.shape.totals.unwrap(),
  original: z
    .object({ id: z.uuid(), number: z.string(), issuer: issuerSnapshotSchema })
    .nullable(),
  adjustment: z
    .object(adjustDocumentSchema.shape)
    .omit({ requestKey: true })
    .extend({
      allocation: z.literal("cumulative_original_components_v1"),
      cumulative: z.array(
        z.object({
          lineId: z.string(),
          netBefore: z.string(),
          netAfter: z.string(),
          components: z.array(
            z.object({
              name: z.string(),
              before: z.string(),
              after: z.string(),
            }),
          ),
        }),
      ),
    })
    .nullable(),
});
export type DocumentSnapshot = z.infer<typeof documentSnapshotSchema>;
export const sellerDocumentSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  periodId: z.uuid(),
  kind: z.enum(["invoice", "credit_note"]),
  number: z.string(),
  snapshot: documentSnapshotSchema,
  actorId: z.string(),
  at: z.iso.datetime(),
  retainUntil: z.iso.datetime(),
  artifact: z.object({
    state: z.enum(["pending", "ready", "failed"]),
    failure: z.string().nullable(),
    sha256: z.string(),
    bytes: z.number(),
  }),
});
export const documentWorkspaceSchema = z.object({
  documents: z.array(sellerDocumentSchema),
  periods: z.array(
    z.object({
      id: z.uuid(),
      paymentId: z.string(),
      start: z.iso.datetime(),
      end: z.iso.datetime(),
      currency: z.enum(["INR", "USD"]),
      totalMinor: z.string().nullable(),
    }),
  ),
  storageReady: z.boolean(),
  storageUsage: z.object({
    storedBytes: z.number(),
    putAttempts: z.number(),
    getAttempts: z.number(),
    uncertainAttempts: z.number(),
  }),
});
export const recoverDocumentSchema = z.strictObject({ documentId: z.uuid() });
export type SellerDocument = z.infer<typeof sellerDocumentSchema>;
