import { z } from "zod";

export const costMonthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const costCategorySchema = z.enum([
  "hosting",
  "database",
  "workers",
  "ai",
  "search",
  "tools",
  "messaging",
  "provisioning",
  "payment",
  "billing_tax",
  "setup",
  "support",
  "sales",
  "maintenance",
  "integration",
]);
const reference = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^[^\u0000-\u001f\u007f]+$/);
export const costMoneySchema = z.strictObject({
  currency: z.enum(["INR", "USD"]),
  micros: z.string().regex(/^-?\d{1,24}$/),
});
export const costSourceSchema = z
  .strictObject({
    month: costMonthSchema,
    provider: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    category: costCategorySchema,
    kind: z.enum([
      "consumption",
      "commitment",
      "cash_topup",
      "subscription_allocation",
      "customer_paid_meta",
      "plan_change",
    ]),
    funding: z.enum([
      "cash",
      "openai_linked_credits",
      "openai_purchased_credits",
      "gateway_prepaid",
      "existing_subscription",
      "byok",
      "fallback",
      "customer_meta",
      "unknown",
    ]),
    amount: costMoneySchema.nullable(),
    quantity: z.number().int().nonnegative().max(1e12).nullable(),
    unit: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
    businessId: z.uuid().nullable(),
    runId: z.uuid().nullable(),
    allocation: reference,
    evidence: reference,
    observedAt: z.iso.datetime(),
    freshUntil: z.iso.datetime(),
    plan: reference.nullable(),
    status: z.enum([
      "recorded",
      "observed_not_settled",
      "estimated",
      "unpriced",
      "uncertain",
    ]),
    // Native metadata is allowlisted by the SQL source adapter. Never prompts, recipients or raw events.
    details: z.record(
      z.string(),
      z.union([
        z.string().max(300),
        z.number().finite(),
        z.boolean(),
        z.null(),
      ]),
    ),
    coversSourceIds: z
      .array(z.string().regex(/^(native|evidence):[a-zA-Z0-9_.:-]+$/))
      .max(1000)
      .optional(),
  })
  .refine((s) => new Date(s.freshUntil) >= new Date(s.observedAt))
  .refine((s) => s.kind === "plan_change" || !s.amount?.micros.startsWith("-"))
  .refine((s) =>
    s.kind === "customer_paid_meta" ||
    s.funding === "customer_meta" ||
    s.provider === "meta"
      ? s.kind === "customer_paid_meta" &&
        s.funding === "customer_meta" &&
        s.provider === "meta"
      : true,
  );
export type CostSource = z.infer<typeof costSourceSchema>;
export const recordCostSchema = z.strictObject({
  sourceId: z.string().regex(/^evidence:[a-zA-Z0-9_.:-]{1,180}$/),
  expectedVersion: z.number().int().nonnegative(),
  source: costSourceSchema,
  reason: reference,
  retentionSeconds: z.number().int().min(60).max(2147483647),
});
export type CostRecord = {
  id: string;
  sourceId: string;
  version: number;
  origin: "native" | "operator";
  source: CostSource;
  reason: string;
  actorId: string;
  at: string;
  retainUntil: string;
};
export const costPlanningSchema = z
  .strictObject({
    month: costMonthSchema,
    expectedVersion: z.number().int().nonnegative(),
    usdToInr: z
      .string()
      .regex(/^\d{1,6}(\.\d{1,6})?$/)
      .refine((v) => Number(v) > 0)
      .nullable(),
    conversionEvidence: reference.nullable(),
    conversionObservedAt: z.iso.datetime().nullable(),
    forecast: z.enum(["linear_elapsed_utc", "none"]),
    assumptions: reference,
    rates: z
      .array(
        z.strictObject({
          provider: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
          unit: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
          model: z.string().max(120).nullable(),
          pricePerUnit: costMoneySchema.nullable(),
          inputPerMillion: costMoneySchema.nullable(),
          outputPerMillion: costMoneySchema.nullable(),
          effectiveAt: z.iso.datetime(),
          freshUntil: z.iso.datetime(),
          evidence: reference,
        }),
      )
      .max(100),
    retentionSeconds: z.number().int().min(60).max(2147483647),
  })
  .refine(
    (v) =>
      v.usdToInr === null ||
      (v.conversionEvidence !== null && v.conversionObservedAt !== null),
  )
  .refine(
    (v) =>
      new Set(v.rates.map((r) => `${r.provider}:${r.unit}:${r.model}`)).size ===
      v.rates.length,
  )
  .refine((v) =>
    v.rates.every(
      (r) =>
        new Date(r.freshUntil).getTime() >= new Date(r.effectiveAt).getTime() &&
        (r.pricePerUnit
          ? !r.inputPerMillion && !r.outputPerMillion
          : r.inputPerMillion &&
            r.outputPerMillion &&
            r.inputPerMillion.currency === r.outputPerMillion.currency) &&
        [r.pricePerUnit, r.inputPerMillion, r.outputPerMillion].every(
          (m) => !m?.micros.startsWith("-"),
        ),
    ),
  );
export type CostPlanning = Omit<
  z.infer<typeof costPlanningSchema>,
  "expectedVersion" | "retentionSeconds"
> & { version: number };
export const costBudgetSchema = z
  .strictObject({
    month: costMonthSchema,
    category: z.union([z.literal("global"), costCategorySchema]),
    expectedVersion: z.number().int().nonnegative(),
    limitInrMicros: z.string().regex(/^[1-9]\d{0,23}$/),
    ownerId: z.string().min(1).max(200),
    email: z.boolean(),
    forecastAlerts: z.boolean(),
    thresholds: z
      .array(z.number().int().min(1).max(1000))
      .min(1)
      .max(10)
      .default([80, 90, 100]),
    retentionSeconds: z.number().int().min(60).max(2147483647),
    note: reference,
  })
  .refine((v) => new Set(v.thresholds).size === v.thresholds.length);
export type CostBudget = Omit<
  z.infer<typeof costBudgetSchema>,
  "expectedVersion"
> & {
  id: string;
  version: number;
  activeUntil?: string;
  automationActive?: boolean;
};
export type CostWork = {
  budgetId: string;
  capability: string;
  userId: string;
  month: string;
};
export type CostAuthority = { userId: string; work?: CostWork };
export type CostAlert = {
  id: string;
  month: string;
  category: string;
  threshold: number;
  measure: "actual" | "forecast";
  ownerId: string;
  budgetId: string;
  valueMicros: string;
  limitMicros: string;
  summary: string;
  emailState:
    "in_app" | "pending" | "sending" | "accepted" | "uncertain" | "held";
  at: string;
  acknowledged: boolean;
};
export type CostMail = { key: string; email: string; text: string };
export type CostMailer = { send(message: CostMail): Promise<{ id: string }> };
export type CostProjection = CostRecord & {
  valuedAmount: z.infer<typeof costMoneySchema> | null;
  pricing: string;
  planningMicros: string | null;
  included: boolean;
  stale: boolean;
  coveredBy: string | null;
};
export type CostWorkspace = {
  delivery: { emailConfigured: boolean; scheduleConfigured: boolean };
  operatorId: string;
  month: string;
  asOf: string;
  sources: CostProjection[];
  history: CostRecord[];
  planning: CostPlanning | null;
  planningHistory: CostPlanning[];
  forecast: {
    basis: "linear_elapsed_utc" | "none";
    knownOnly: true;
    operatorMicros: string | null;
    elapsedSeconds: number;
    monthSeconds: number;
    assumptions: string;
    coverage: string;
  };
  totals: {
    operatorMicros: string;
    unpriced: number;
    unconverted: number;
    operatorByCurrency: Record<string, string>;
    cashTopups: Record<string, string>;
    customerPaid: Record<string, string>;
    linkedCreditConsumption: Record<string, string>;
    subscriptionAllocation: Record<string, string>;
    stale: number;
  };
  categories: Record<
    string,
    { operatorMicros: string; forecastMicros: string | null; unpriced: number }
  >;
  coverage: {
    nativeScanAt: string | null;
    missingProviderEvidence: string[];
    unpricedSourceIds: string[];
    estimatedSourceIds: string[];
    unsettledSourceIds: string[];
    unresolvedFundingSourceIds: string[];
  };
  budgets: CostBudget[];
  alerts: CostAlert[];
};
const costRecordViewSchema = z.object({
  id: z.uuid(),
  sourceId: z.string(),
  version: z.number().int(),
  origin: z.enum(["native", "operator"]),
  source: costSourceSchema,
  reason: z.string(),
  actorId: z.string(),
  at: z.iso.datetime(),
  retainUntil: z.iso.datetime(),
});
const planningViewSchema = z
  .object(costPlanningSchema.shape)
  .omit({ expectedVersion: true, retentionSeconds: true })
  .extend({ version: z.number().int() });
const budgetViewSchema = z
  .object(costBudgetSchema.shape)
  .omit({ expectedVersion: true })
  .extend({
    id: z.uuid(),
    version: z.number().int(),
    activeUntil: z.iso.datetime().optional(),
    automationActive: z.boolean().optional(),
  });
const alertViewSchema = z.object({
  id: z.uuid(),
  month: costMonthSchema,
  category: z.string(),
  threshold: z.number(),
  measure: z.enum(["actual", "forecast"]),
  ownerId: z.string(),
  budgetId: z.uuid(),
  valueMicros: z.string(),
  limitMicros: z.string(),
  summary: z.string(),
  emailState: z.enum([
    "in_app",
    "pending",
    "sending",
    "accepted",
    "uncertain",
    "held",
  ]),
  at: z.iso.datetime(),
  acknowledged: z.boolean(),
});
const currencyTotals = z.record(z.string(), z.string());
export const costWorkspaceSchema = z.object({
  delivery: z.object({
    emailConfigured: z.boolean(),
    scheduleConfigured: z.boolean(),
  }),
  operatorId: z.string(),
  month: costMonthSchema,
  asOf: z.iso.datetime(),
  history: z.array(costRecordViewSchema),
  sources: z.array(
    costRecordViewSchema.extend({
      valuedAmount: costMoneySchema.nullable(),
      pricing: z.string(),
      planningMicros: z.string().nullable(),
      included: z.boolean(),
      stale: z.boolean(),
      coveredBy: z.string().nullable(),
    }),
  ),
  planning: planningViewSchema.nullable(),
  planningHistory: z.array(planningViewSchema),
  budgets: z.array(budgetViewSchema),
  alerts: z.array(alertViewSchema),
  totals: z.object({
    operatorMicros: z.string(),
    unpriced: z.number(),
    unconverted: z.number(),
    operatorByCurrency: currencyTotals,
    cashTopups: currencyTotals,
    customerPaid: currencyTotals,
    linkedCreditConsumption: currencyTotals,
    subscriptionAllocation: currencyTotals,
    stale: z.number(),
  }),
  forecast: z.object({
    basis: z.enum(["linear_elapsed_utc", "none"]),
    knownOnly: z.literal(true),
    operatorMicros: z.string().nullable(),
    elapsedSeconds: z.number(),
    monthSeconds: z.number(),
    assumptions: z.string(),
    coverage: z.string(),
  }),
  categories: z.record(
    z.string(),
    z.object({
      operatorMicros: z.string(),
      forecastMicros: z.string().nullable(),
      unpriced: z.number(),
    }),
  ),
  coverage: z.object({
    nativeScanAt: z.string().nullable(),
    missingProviderEvidence: z.array(z.string()),
    unpricedSourceIds: z.array(z.string()),
    estimatedSourceIds: z.array(z.string()),
    unsettledSourceIds: z.array(z.string()),
    unresolvedFundingSourceIds: z.array(z.string()),
  }),
}) satisfies z.ZodType<CostWorkspace>;
export function formatCostMoney(micros: string, currency = "INR") {
  const value = BigInt(micros),
    absolute = value < 0n ? -value : value;
  const whole = absolute / 1000000n,
    part = (absolute % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${currency} ${value < 0n ? "-" : ""}${whole.toLocaleString("en-IN")}${part ? `.${part}` : ""}`;
}
