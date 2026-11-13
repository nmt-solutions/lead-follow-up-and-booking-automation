import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { isPlanId, publishedOffers, type PlanId } from "../content/plans";
import type { SubscriptionOffer } from "../models/subscription-quotes";
import type { PaymentSnapshot } from "../models/subscription-payments";
import { razorpayAccountReviewSchema } from "../models/razorpay-account";
import { lifecyclePolicySchema } from "../models/subscription-lifecycle";
import { sellerDetails } from "../content/seller";
import { validGstin } from "../models/india-gst";
import {
  adjustmentPolicySchema,
  currentAdjustmentPolicy,
} from "../models/financial-adjustments";

/** New purchases only. Historical reconciliation and cancellation keep their original scope. */
export function indiaCheckoutIssues(snapshot: PaymentSnapshot): string[] {
  return snapshot.quote.currency === "INR" &&
    snapshot.quote.profile.profile.address.country === "IN"
    ? []
    : ["india_only_checkout"];
}
export function productionCheckoutIssues(
  snapshot: PaymentSnapshot,
  env: Record<string, string | undefined>,
  at: Date,
): string[] {
  const id = snapshot.quote.selection.offerId;
  return [
    ...indiaCheckoutIssues(snapshot),
    ...(isPlanId(id) &&
    publishedOfferMatches(snapshot.quote.pricing.offer, id) &&
    snapshot.quote.selection.term === "monthly" &&
    snapshot.quote.selection.reservedCapacityId === null &&
    snapshot.term.kind === "calendar_month"
      ? []
      : ["published_india_plan_required"]),
    ...productionSubscriptionIssues(env, at),
  ];
}

export const sellerPublicProfileSchema = z
  .strictObject({
    legalName: z.string().trim().min(1).max(200),
    cin: z.string().trim().min(1).max(30),
    address: z.string().trim().min(10).max(1000),
    phone: z.string().trim().min(8).max(30),
    supportEmail: z.email(),
    grievanceOfficer: z.string().trim().min(1).max(200),
    grievanceEmail: z.email(),
    gstStatus: z.enum(["registered", "not_registered"]),
    gstin: z.string().trim().max(30),
  })
  .refine((value) =>
    value.gstStatus === "registered"
      ? validGstin(value.gstin)
      : value.gstin === "",
  );
export function sellerPublicProfile(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    return sellerPublicProfileSchema.parse(
      env.SELLER_PUBLIC_PROFILE
        ? JSON.parse(env.SELLER_PUBLIC_PROFILE)
        : sellerDetails,
    );
  } catch {
    return null;
  }
}
export function publishedOfferMatches(
  offer: SubscriptionOffer,
  id: PlanId,
): boolean {
  return isDeepStrictEqual(
    offer,
    publishedOffers().find((plan) => plan.id === id),
  );
}
/** Checks configuration, never asserts merchant or legal approval. No secret values in results. */
export function productionSubscriptionIssues(
  env: Record<string, string | undefined> = process.env,
  at = new Date(),
): string[] {
  const issues: string[] = [];
  let account: string | null = null;
  if (!sellerPublicProfile(env)) issues.push("seller_public_details_required");
  try {
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(env.RAZORPAY_ACCOUNT_REVIEW ?? "null"),
    );
    account = `${review.account}:${review.mode}`;
    if (
      review.mode !== "live" ||
      !env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ||
      !env.RAZORPAY_KEY_SECRET
    )
      issues.push("live_razorpay_credentials_required");
    if (
      !review.subscriptions ||
      !review.methods.card ||
      review.methods.upi ||
      review.methods.emandate ||
      review.upiPath ||
      !review.domestic.enabled
    )
      issues.push("recurring_card_approval_required");
    if (
      new Date(review.checkedAt) > at ||
      new Date(review.effectiveFrom) > at ||
      new Date(review.effectiveUntil) <= at
    )
      issues.push("current_razorpay_review_required");
    for (const plan of publishedOffers())
      if (
        review.plans.filter(
          (mapping) =>
            mapping.offerId === plan.id &&
            mapping.reservedCapacityId === null &&
            mapping.currency === "INR",
        ).length !== 1
      )
        issues.push(`native_plan_${plan.id}_required`);
  } catch {
    issues.push("razorpay_account_review_required");
  }
  try {
    z.array(z.string().trim().min(1))
      .min(1)
      .max(3)
      .parse(JSON.parse(env.RAZORPAY_WEBHOOK_SECRETS ?? "null"));
  } catch {
    issues.push("signed_payment_webhooks_required");
  }
  try {
    const policy = lifecyclePolicySchema.parse(
      JSON.parse(env.SUBSCRIPTION_LIFECYCLE_POLICY ?? "null"),
    );
    if (
      policy.mode !== "live" ||
      new Date(policy.checkedAt) > at ||
      new Date(policy.effectiveFrom) > at ||
      new Date(policy.effectiveUntil) <= at ||
      policy.cancellationTiming !== "cycle_end" ||
      policy.cancellationAccess !== "paid_through"
    )
      issues.push("live_cancellation_policy_required");
  } catch {
    issues.push("live_cancellation_policy_required");
  }
  try {
    const policy = adjustmentPolicySchema.parse(
      JSON.parse(env.FINANCIAL_ADJUSTMENT_POLICY ?? "null"),
    );
    currentAdjustmentPolicy(policy, at, account ?? "", "live");
    if (!policy.normalRefunds)
      issues.push("live_refund_dispute_policy_required");
  } catch {
    issues.push("live_refund_dispute_policy_required");
  }
  if (
    !env.TRIGGER_SECRET_KEY?.startsWith("tr_prod_") ||
    !env.TRIGGER_PROJECT_REF ||
    !env.TRIGGER_PAYMENT_RECOVERY_CRON ||
    !env.TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON ||
    !env.TRIGGER_SELLER_DOCUMENT_RECOVERY_CRON ||
    !env.TRIGGER_FINANCIAL_ADJUSTMENTS_CRON ||
    !env.TRIGGER_PRODUCTION_DEPLOYMENT_VERSION
  )
    issues.push("production_workers_required");
  if (env.SELLER_DOCUMENT_STORAGE_PROTECTED_CONFIRMED !== "true")
    issues.push("protected_invoice_storage_required");
  return issues;
}
