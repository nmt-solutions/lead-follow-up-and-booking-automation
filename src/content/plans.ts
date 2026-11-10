import type { SubscriptionOffer } from "@/models/subscription-quotes";

// Public commercial terms only. Vendor costs and operator configuration stay server-side.
export const planVersion = "2026-11-10";
export const plans = [
  {
    id: "starter",
    label: "Starter",
    monthlyMinor: 199900,
    discovery: 1200,
    automation: 500,
    description: "A focused start for your business.",
  },
  {
    id: "growth",
    label: "Growth",
    monthlyMinor: 499900,
    discovery: 4000,
    automation: 2000,
    description: "More room for regular prospecting.",
  },
  {
    id: "scale",
    label: "Scale",
    monthlyMinor: 999900,
    discovery: 10000,
    automation: 5000,
    description: "Higher allowances for a busy team.",
  },
] as const;
export type PlanId = (typeof plans)[number]["id"];
export function isPlanId(value: unknown): value is PlanId {
  return plans.some((plan) => plan.id === value);
}
export const renewalTerms =
  "Billed monthly until cancelled. Cancel from Plan & billing before the next renewal. Confirmed cancellation stops future renewals; access continues until the end of the paid period. Unused allowances expire at the period end. No automatic overage charges. Applicable taxes are shown before payment.";
export function publishedOffers(): SubscriptionOffer[] {
  return plans.map((plan) => ({
    id: plan.id,
    label: plan.label,
    markets: ["India"],
    discovery: { quantity: plan.discovery, unit: "discovery credits" },
    automation: { quantity: plan.automation, unit: "provider calls" },
    prices: {
      INR: { monthlyMinor: plan.monthlyMinor, pilotMinor: null },
      USD: null,
    },
    pilot: null,
    reservedCapacity: [],
    renewalTerms,
  }));
}
export function formatPlanPrice(minor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(minor / 100);
}
