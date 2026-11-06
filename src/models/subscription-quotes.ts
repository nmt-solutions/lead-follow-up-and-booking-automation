import { z } from "zod";
import {
  billingRevisionSchema,
  billingReviewSchema,
  billingWorkspaceSchema,
  type BillingWorkspace,
} from "./billing";

const text = z.string().trim().min(1).max(200);
const key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
const version = z.number().int().min(0).max(2147483646);
// Both selected currencies have two decimal places. No FX conversion is performed.
const amount = z.number().int().min(0).max(1_000_000_000_000);
const subtotal = z.number().int().min(0).max(2_000_000_000_000);
export const allowanceSchema = z.strictObject({
  quantity: z.number().int().min(0).max(1_000_000_000),
  unit: text,
});
const priceSchema = z.strictObject({
  monthlyMinor: amount.positive().nullable(),
  pilotMinor: amount.positive().nullable(),
});
const pricesSchema = z.strictObject({
  INR: priceSchema.nullable(),
  USD: priceSchema.nullable(),
});
export const reservedCapacitySchema = z.strictObject({
  id: key,
  label: text,
  capacity: allowanceSchema.extend({
    quantity: z.number().int().positive().max(1_000_000_000),
  }),
  prices: pricesSchema,
});
export const subscriptionOfferSchema = z.strictObject({
  id: key,
  label: text,
  markets: z
    .array(text)
    .min(1)
    .max(30)
    .refine(
      (values) =>
        new Set(values.map((value) => value.toLowerCase())).size ===
        values.length,
      "Use distinct markets.",
    ),
  discovery: allowanceSchema.nullable(),
  automation: allowanceSchema.nullable(),
  prices: pricesSchema,
  pilot: z
    .strictObject({
      days: z.number().int().positive().max(366),
      discovery: allowanceSchema.nullable(),
      automation: allowanceSchema.nullable(),
    })
    .nullable(),
  renewalTerms: z.string().trim().min(1).max(2000),
  reservedCapacity: z
    .array(reservedCapacitySchema)
    .max(20)
    .refine(
      (values) =>
        new Set(values.map((value) => value.id)).size === values.length,
      "Use distinct capacity identifiers.",
    ),
});
export const pricingConfigureSchema = z.strictObject({
  expectedVersion: version,
  effectiveFrom: z.iso.datetime().nullable(),
  note: z.string().trim().min(1).max(1000),
  offers: z
    .array(subscriptionOfferSchema)
    .max(50)
    .refine(
      (values) =>
        new Set(values.map((value) => value.id)).size === values.length,
      "Use distinct offer identifiers.",
    ),
});
export const pricingRevisionSchema = pricingConfigureSchema
  .omit({ expectedVersion: true })
  .extend({
    effectiveFrom: z.iso.datetime(),
    id: z.uuid(),
    version: version.min(1),
    actorId: z.string(),
    actorName: z.string(),
    at: z.iso.datetime(),
  });
export const pricingCatalogSchema = z.object({
  version,
  current: pricingRevisionSchema.nullable(),
  history: z.array(pricingRevisionSchema),
});
export type SubscriptionOffer = z.infer<typeof subscriptionOfferSchema>;
export type PricingConfigure = z.infer<typeof pricingConfigureSchema>;
export type PricingRevision = z.infer<typeof pricingRevisionSchema>;
export type PricingCatalog = z.infer<typeof pricingCatalogSchema>;

export const quoteRequestSchema = z.strictObject({
  expectedCatalogVersion: version.min(1),
  expectedBillingVersion: version.min(1),
  expectedReviewVersion: version.min(1),
  offerId: key,
  reservedCapacityId: key.nullable(),
  term: z.enum(["monthly", "paid_pilot"]),
  requestKey: z.uuid(),
});
const quoteLineSchema = z.object({
  kind: z.enum(["subscription", "reserved_capacity"]),
  label: text,
  amountMinor: amount,
});
export const subscriptionQuoteSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  selection: quoteRequestSchema,
  currency: z.enum(["INR", "USD"]),
  profile: billingRevisionSchema,
  billingReview: billingReviewSchema,
  pricing: z.object({
    id: z.uuid(),
    version: version.min(1),
    effectiveFrom: z.iso.datetime(),
    offer: subscriptionOfferSchema,
    reservedCapacity: reservedCapacitySchema.nullable(),
  }),
  initial: z.object({
    kind: quoteRequestSchema.shape.term,
    days: z.number().int().positive().nullable(),
    lines: z.array(quoteLineSchema),
    subtotalMinor: subtotal,
    discovery: allowanceSchema,
    automation: allowanceSchema,
  }),
  renewal: z.object({
    interval: z.literal("month"),
    lines: z.array(quoteLineSchema),
    subtotalMinor: subtotal,
    discovery: allowanceSchema,
    automation: allowanceSchema,
    terms: z.string(),
  }),
  meta: z.object({
    payer: z.literal("business_direct"),
    includedInPlatformSubtotal: z.literal(false),
    prepaidCredit: z.literal(false),
    guaranteedMessages: z.literal(false),
  }),
  tax: z.object({
    status: z.literal("not_calculated"),
    amountMinor: z.null(),
    totalMinor: z.null(),
  }),
  grantsEntitlements: z.literal(false),
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
});
export const quoteReviewSchema = z.object({
  snapshot: subscriptionQuoteSchema,
  commercialReady: z.boolean(),
  issues: z.array(z.string()),
  checkoutReady: z.literal(false),
  launchGates: z.array(
    z.enum(["tax_calculation_required", "gateway_checkout_required"]),
  ),
});
export const subscriptionQuoteWorkspaceSchema = z.object({
  billing: billingWorkspaceSchema,
  currency: z.enum(["INR", "USD"]).nullable(),
  catalogVersion: version,
  offers: z.array(subscriptionOfferSchema),
  quotes: z.array(quoteReviewSchema),
  issues: z.array(z.string()),
  checkoutReady: z.literal(false),
});
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type SubscriptionQuote = z.infer<typeof subscriptionQuoteSchema>;
export type QuoteReview = z.infer<typeof quoteReviewSchema>;
export type SubscriptionQuoteWorkspace = z.infer<
  typeof subscriptionQuoteWorkspaceSchema
>;

export const quoteIssueLabels: Record<string, string> = {
  billing_review_required:
    "Complete the billing evidence review before creating a quote.",
  billing_currency_unknown:
    "Confirm the billing country to determine INR or USD pricing.",
  pricing_configuration_missing:
    "The operator has not configured any currently effective offers.",
  price_missing: "This currency has no explicit price for the selected term.",
  renewal_price_missing:
    "The monthly renewal price is missing for this currency.",
  discovery_allowance_missing:
    "The included discovery allowance needs configuration.",
  automation_allowance_missing:
    "The included automation allowance needs configuration.",
  pilot_not_offered: "This offer has no configured paid pilot.",
  pilot_allowance_missing: "The paid pilot allowances need configuration.",
  reserved_capacity_not_offered:
    "The selected reserved capacity is unavailable.",
  reserved_capacity_price_missing:
    "The reserved capacity price or renewal price is missing for this currency.",
  offer_unavailable: "Choose a currently effective reach offer.",
  pricing_changed:
    "Pricing has changed. Create a new quote to review the current terms.",
  billing_changed:
    "Billing details or their review changed. Create a new quote after review.",
};
export const metaDisclosure =
  "Meta messaging is billed directly to the Business by Meta using its own account and payment method, separately from this platform subscription. No prepaid Meta credit is included or charged here. Automation allowances do not guarantee Meta messages, delivery, leads or sales.";
export const reachDisclosure =
  "Quoted reach covers prospect discovery and new-prospect campaigns. Incoming inquiries and engaged conversations can continue from any geography under the applicable communication rules. Creating a quote does not activate reach, reserved capacity or additional usage; extra spending requires separate approval.";

export function commercialIssues(
  billing: BillingWorkspace,
  pricing: PricingRevision | null,
) {
  return [
    ...(billing.status === "reviewed" ? [] : ["billing_review_required"]),
    ...(billing.currency ? [] : ["billing_currency_unknown"]),
    ...(pricing?.offers.length ? [] : ["pricing_configuration_missing"]),
  ];
}
export function selectionIssues(
  offer: SubscriptionOffer | undefined,
  currency: "INR" | "USD" | null,
  term: QuoteRequest["term"],
  reservedCapacityId: string | null,
) {
  if (!offer) return ["offer_unavailable"];
  const price = currency ? offer.prices[currency] : null;
  const reserved = offer.reservedCapacity.find(
    (item) => item.id === reservedCapacityId,
  );
  const reservedPrice = currency ? reserved?.prices[currency] : null;
  return [
    ...((term === "monthly" ? price?.monthlyMinor : price?.pilotMinor)
      ? []
      : ["price_missing"]),
    ...(price?.monthlyMinor ? [] : ["renewal_price_missing"]),
    ...(offer.discovery ? [] : ["discovery_allowance_missing"]),
    ...(offer.automation ? [] : ["automation_allowance_missing"]),
    ...(term !== "paid_pilot" || offer.pilot ? [] : ["pilot_not_offered"]),
    ...(term !== "paid_pilot" ||
    (offer.pilot?.discovery && offer.pilot.automation)
      ? []
      : ["pilot_allowance_missing"]),
    ...(!reservedCapacityId || reserved
      ? []
      : ["reserved_capacity_not_offered"]),
    ...(!reservedCapacityId ||
    (reservedPrice?.monthlyMinor &&
      (term !== "paid_pilot" || reservedPrice.pilotMinor))
      ? []
      : ["reserved_capacity_price_missing"]),
  ];
}
export function reviewSubscriptionQuote(
  snapshot: SubscriptionQuote,
  billing: BillingWorkspace,
  pricing: PricingRevision | null,
): QuoteReview {
  const issues = commercialIssues(billing, pricing);
  if (snapshot.pricing.id !== pricing?.id) issues.push("pricing_changed");
  if (
    snapshot.profile.id !== billing.current?.id ||
    snapshot.billingReview.version !== billing.reviewVersion
  )
    issues.push("billing_changed");
  return {
    snapshot,
    commercialReady: issues.length === 0,
    issues,
    checkoutReady: false,
    launchGates: ["tax_calculation_required", "gateway_checkout_required"],
  };
}
