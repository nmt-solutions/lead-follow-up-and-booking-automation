import { z } from "zod";
import { billingProfileSchema, billingWorkspaceSchema } from "./billing";

const note = z.string().trim().min(1).max(1000);
const label = z.string().trim().min(1).max(200);
const version = z.number().int().min(0).max(2147483646);
const country =
  billingProfileSchema.shape.address.shape.country.refine(Boolean);
export const taxModeSchema = z.enum(["fixture", "live"]);
export const taxCurrencySchema = z.enum(["INR", "USD"]);
const window = {
  effectiveFrom: z.iso.datetime(),
  effectiveUntil: z.iso.datetime().nullable(),
};
const validWindow = (value: {
  effectiveFrom: string;
  effectiveUntil: string | null;
}) =>
  !value.effectiveUntil ||
  new Date(value.effectiveUntil).getTime() >
    new Date(value.effectiveFrom).getTime();
export const taxRuleSchema = z
  .strictObject({
    mode: taxModeSchema,
    customerCountry: country,
    customerRegion: z.string().trim().min(1).max(300).nullable(),
    buyerStatus: z.enum(["business", "individual"]),
    currency: taxCurrencySchema,
    productCode: label,
    ...window,
    jurisdiction: z.strictObject({ code: label, name: label, country }),
    registration: z
      .strictObject({
        status: z.enum(["registered", "not_required"]),
        identifier: label,
        ...window,
      })
      .refine(validWindow, "Registration end must follow its start."),
    treatment: z.enum([
      "taxable",
      "zero_rated",
      "exempt",
      "reverse_charge",
      "export",
    ]),
    rationale: note,
    requiredEvidence: z
      .array(
        z.enum([
          "legal_identity",
          "billing_address",
          "business_status",
          "tax_identifier",
        ]),
      )
      .min(1)
      .max(4),
    evidenceBasis: z.enum(["documents", "customer_declaration"]).optional(),
    rates: z
      .array(
        z.strictObject({
          name: label,
          numerator: z.string().regex(/^[1-9][0-9]{0,8}$/),
          denominator: z.string().regex(/^[1-9][0-9]{0,8}$/),
        }),
      )
      .max(10),
    rounding: z.strictObject({
      mode: z.enum(["half_up", "half_even", "down"]),
      scope: z.enum(["per_line", "subtotal"]),
      incrementMinor: z.enum(["1", "5", "10", "100"]),
    }),
    evidence: z
      .array(
        z.strictObject({
          title: label,
          reference: note,
          checkedAt: z.iso.datetime(),
        }),
      )
      .min(1)
      .max(20),
  })
  .refine(validWindow, "Rule end must follow its start.")
  .refine(
    (value) => (value.treatment === "taxable") === value.rates.length > 0,
    "Taxable treatment needs rates; other treatments require an explicit zero-rate decision.",
  )
  .refine(
    (value) =>
      new Set(value.rates.map((rate) => rate.name)).size === value.rates.length,
    "Rate names must be distinct.",
  );
export const taxRuleSaveSchema = z.strictObject({
  key: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  expectedVersion: version,
  rule: taxRuleSchema,
  note,
});
export const taxDecisionInputSchema = z.strictObject({
  revisionId: z.uuid(),
  expectedDecisionVersion: version,
  outcome: z.enum(["approved", "withdrawn"]),
  note,
});
const attribution = {
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
};
export const taxRuleRevisionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  version: version,
  rule: taxRuleSchema,
  ...attribution,
});
export const taxDecisionSchema = z.object({
  id: z.uuid(),
  revisionId: z.uuid(),
  version,
  outcome: taxDecisionInputSchema.shape.outcome,
  ...attribution,
});
export const taxCatalogSchema = z.object({
  revisions: z.array(taxRuleRevisionSchema),
  decisions: z.array(taxDecisionSchema),
});
const amount = z.string().regex(/^(0|[1-9][0-9]{0,23})$/);
const lineInputSchema = z.strictObject({
  id: label,
  productCode: label,
  description: label,
  unitAmountMinor: amount,
  quantity: z.number().int().positive().max(1000000),
});
export const taxCalculationInputSchema = z
  .strictObject({
    requestKey: z.uuid(),
    expectedProfileVersion: version,
    expectedReviewVersion: version,
    currency: taxCurrencySchema,
    lines: z.array(lineInputSchema).min(1).max(40),
    note,
  })
  .refine(
    (value) =>
      new Set(value.lines.map((line) => line.id)).size === value.lines.length,
    "Line identifiers must be distinct.",
  );
export const taxResolveSchema = z.strictObject({
  calculationId: z.uuid(),
  requestKey: z.uuid(),
  expectedProfileVersion: version,
  expectedReviewVersion: version,
  note,
});
const calculatedAmount = z.string().regex(/^(0|[1-9][0-9]{0,59})$/);
const totalsSchema = z.object({
  netMinor: calculatedAmount,
  taxMinor: calculatedAmount,
  totalMinor: calculatedAmount,
});
export const taxCalculationSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  businessId: z.uuid(),
  requestKey: z.uuid(),
  resolvesId: z.uuid().nullable(),
  purpose: z.literal("tax_preview"),
  mode: taxModeSchema,
  currency: taxCurrencySchema,
  minorUnit: z.literal(2),
  input: taxCalculationInputSchema,
  status: z.enum(["calculated", "review_required"]),
  reasons: z.array(
    z.object({
      kind: z.enum(["missing", "conflicting", "unsupported"]),
      code: z.string(),
      lineId: z.string().nullable(),
    }),
  ),
  billing: billingWorkspaceSchema,
  configuration: taxCatalogSchema,
  lines: z.array(
    z.object({
      input: lineInputSchema,
      netMinor: calculatedAmount,
      taxMinor: calculatedAmount,
      totalMinor: calculatedAmount,
      components: z.array(
        z.object({ name: z.string(), amountMinor: calculatedAmount }),
      ),
      rule: z.object({
        revision: taxRuleRevisionSchema,
        approval: taxDecisionSchema,
      }),
    }),
  ),
  totals: totalsSchema.nullable(),
  ...attribution,
});
export const taxWorkspaceSchema = z.object({
  billing: billingWorkspaceSchema,
  mode: taxModeSchema,
  calculations: z.array(taxCalculationSchema),
});
export const taxQueueSchema = z.array(
  z.object({ businessId: z.uuid(), calculation: taxCalculationSchema }),
);
export type TaxRule = z.infer<typeof taxRuleSchema>;
export type TaxRuleSave = z.infer<typeof taxRuleSaveSchema>;
export type TaxDecisionInput = z.infer<typeof taxDecisionInputSchema>;
export type TaxCatalog = z.infer<typeof taxCatalogSchema>;
export type TaxCalculationInput = z.infer<typeof taxCalculationInputSchema>;
export type TaxCalculation = z.infer<typeof taxCalculationSchema>;
export type TaxResolve = z.infer<typeof taxResolveSchema>;
export type TaxWorkspace = z.infer<typeof taxWorkspaceSchema>;
export type TaxMode = z.infer<typeof taxModeSchema>;

/** Currency values stay decimal strings at every JSON boundary. No binary float conversion. */
export function formatTaxMoney(minor: string, currency: string) {
  const value = BigInt(minor);
  return `${currency} ${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}
