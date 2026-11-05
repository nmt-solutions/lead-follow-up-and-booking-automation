import { z } from "zod";

export const commercialActions = [
  "prices",
  "quotations",
  "discounts",
  "orders",
] as const;
export const commercialActionLabels = {
  prices: "Prices",
  quotations: "Custom quotations",
  discounts: "Discounts",
  orders: "Order acceptance",
};
export const commercialActionSchema = z.enum(commercialActions);
export const commercialCurrencies = Intl.supportedValuesOf("currency");
export const moneySchema = z.strictObject({
  currency: z
    .string()
    .refine(
      (code) => commercialCurrencies.includes(code),
      "Select a supported currency.",
    ),
  minor: z
    .string()
    .regex(
      /^(0|[1-9][0-9]{0,29})$/,
      "Enter a nonnegative whole number of minor units (up to 30 digits).",
    ),
});
export function currencyPrecision(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
/** Decimal text stays exact through conversion; no floating point monetary arithmetic. */
export function moneyFromDecimal(
  currency: string,
  value: string,
): z.infer<typeof moneySchema> | null {
  if (
    !commercialCurrencies.includes(currency) ||
    !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  )
    return null;
  const [whole, fraction = ""] = value.split(".");
  const precision = currencyPrecision(currency);
  if (fraction.length > precision) return null;
  const minor = `${whole}${fraction.padEnd(precision, "0")}`.replace(
    /^0+(?=\d)/,
    "",
  );
  const parsed = moneySchema.safeParse({ currency, minor });
  return parsed.success ? parsed.data : null;
}
export function decimalMoney(money: z.infer<typeof moneySchema>): string {
  const precision = currencyPrecision(money.currency);
  const padded = money.minor.padStart(precision + 1, "0");
  return precision
    ? `${padded.slice(0, -precision)}.${padded.slice(-precision)}`
    : padded;
}
export function discountFromPercent(value: string): number | null {
  if (!/^(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= 10000 ? bps : null;
}
export function percentDiscount(bps: number): string {
  return `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;
}
export const commercialRuleSchema = z.strictObject({
  automationEnabled: z.boolean(),
  approvalRequired: z.boolean(),
  amountLimit: moneySchema.nullable(),
  discountLimitBps: z.number().int().min(0).max(10000).nullable(),
  escalationOwnerId: z.string().min(1).max(256).nullable(),
});
export const commercialPolicySchema = z
  .strictObject({
    prices: commercialRuleSchema,
    quotations: commercialRuleSchema,
    discounts: commercialRuleSchema,
    orders: commercialRuleSchema,
  })
  .superRefine((policy, context) => {
    for (const action of commercialActions) {
      const rule = policy[action];
      if (
        rule.automationEnabled &&
        (!rule.amountLimit ||
          !rule.escalationOwnerId ||
          (action === "discounts" && rule.discountLimitBps === null))
      )
        context.addIssue({
          code: "custom",
          path: [action],
          message:
            "Enabled actions need an amount limit and escalation owner; discounts also need a discount limit.",
        });
      if (!rule.automationEnabled && !rule.approvalRequired)
        context.addIssue({
          code: "custom",
          path: [action],
          message: "Disabled automation must require approval.",
        });
    }
  });
export const commercialChangeSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  policy: commercialPolicySchema,
  note: z.string().trim().min(1, "Enter a reason for this change.").max(1000),
});
export type CommercialChange = z.infer<typeof commercialChangeSchema>;
export type CommercialPolicy = z.infer<typeof commercialPolicySchema>;
export function defaultCommercialPolicy(): CommercialPolicy {
  const rule = () => ({
    automationEnabled: false,
    approvalRequired: true,
    amountLimit: null,
    discountLimitBps: null,
    escalationOwnerId: null,
  });
  return {
    prices: rule(),
    quotations: rule(),
    discounts: rule(),
    orders: rule(),
  };
}
export const commercialRevisionSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  version: z.number().int().positive(),
  policy: commercialPolicySchema,
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});
const commercialApproverSchema = z.object({
  userId: z.string(),
  name: z.string(),
  role: z.enum(["owner", "admin"]),
});
export const commercialWorkspaceSchema = z.object({
  version: z.number().int().nonnegative(),
  policy: commercialPolicySchema,
  history: z.array(commercialRevisionSchema),
  canManage: z.boolean(),
  approvers: z.array(commercialApproverSchema),
});
export type CommercialWorkspace = z.infer<typeof commercialWorkspaceSchema>;
export const commercialEvaluationSchema = z.strictObject({
  action: commercialActionSchema,
  amount: moneySchema.nullable(),
  discountBps: z.number().int().min(0).max(10000).nullable(),
});
export type CommercialEvaluationInput = z.infer<
  typeof commercialEvaluationSchema
>;
export const commercialEvaluationResultSchema = z.object({
  status: z.enum(["permitted", "approval_required"]),
  reason: z.enum([
    "within_limits",
    "automation_disabled",
    "approval_required",
    "information_missing",
    "amount_exceeded",
    "discount_exceeded",
    "currency_mismatch",
    "escalation_owner_unavailable",
  ]),
  version: z.number().int().nonnegative(),
  evaluatedAt: z.iso.datetime(),
  action: commercialActionSchema,
  checkedAction: commercialActionSchema,
  escalationOwner: commercialApproverSchema.nullable(),
  nextAction: z.string(),
});

/** A current-state policy decision, never a reusable execution grant or a confirmed commitment. */
export function evaluateCommercialAuthority(
  state: CommercialWorkspace,
  input: CommercialEvaluationInput,
  at: Date,
): z.infer<typeof commercialEvaluationResultSchema> {
  const actions =
    input.discountBps !== null &&
    input.discountBps > 0 &&
    input.action !== "discounts"
      ? [input.action, "discounts" as const]
      : [input.action];
  for (const action of actions) {
    const rule = state.policy[action];
    const owner =
      state.approvers.find(
        (member) => member.userId === rule.escalationOwnerId,
      ) ?? null;
    const reason = !rule.automationEnabled
      ? "automation_disabled"
      : !owner
        ? "escalation_owner_unavailable"
        : rule.approvalRequired
          ? "approval_required"
          : !input.amount || input.discountBps === null || !rule.amountLimit
            ? "information_missing"
            : input.amount.currency !== rule.amountLimit.currency
              ? "currency_mismatch"
              : BigInt(input.amount.minor) > BigInt(rule.amountLimit.minor)
                ? "amount_exceeded"
                : input.discountBps > (rule.discountLimitBps ?? 0)
                  ? "discount_exceeded"
                  : null;
    if (reason)
      return {
        status: "approval_required",
        reason,
        version: state.version,
        evaluatedAt: at.toISOString(),
        action: input.action,
        checkedAction: action,
        escalationOwner: owner,
        nextAction: owner
          ? `Request approval from ${owner.name}; do not make a commercial commitment.`
          : "Ask an Owner or Admin to configure an available escalation owner; do not make a commercial commitment.",
      };
  }
  return {
    status: "permitted",
    reason: "within_limits",
    version: state.version,
    evaluatedAt: at.toISOString(),
    action: input.action,
    checkedAction: input.action,
    escalationOwner: null,
    nextAction:
      "Within current commercial policy. Re-evaluate at execution and apply ownership, channel and authoritative confirmation requirements before acting.",
  };
}
