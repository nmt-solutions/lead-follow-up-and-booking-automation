import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { publishedOffers, type PlanId } from "../content/plans";
import type { SubscriptionOffer } from "../models/subscription-quotes";
import { razorpayAccountReviewSchema } from "../models/razorpay-account";
import { lifecyclePolicySchema } from "../models/subscription-lifecycle";
import { sellerDetails } from "../content/seller";
import { validGstin } from "../models/india-gst";

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
  if (!sellerPublicProfile(env)) issues.push("seller_public_details_required");
  try {
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(env.RAZORPAY_ACCOUNT_REVIEW ?? "null"),
    );
    if (
      review.mode !== "live" ||
      !env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ||
      !env.RAZORPAY_KEY_SECRET
    )
      issues.push("live_razorpay_credentials_required");
    if (
      !review.subscriptions ||
      !review.methods.card ||
      review.methods.emandate ||
      !review.domestic.enabled
    )
      issues.push("recurring_card_approval_required");
    if (
      new Date(review.effectiveFrom) > at ||
      new Date(review.effectiveUntil) <= at
    )
      issues.push("current_razorpay_review_required");
    for (const plan of publishedOffers())
      if (
        !review.plans.some(
          (mapping) =>
            mapping.offerId === plan.id &&
            mapping.reservedCapacityId === null &&
            mapping.currency === "INR",
        )
      )
        issues.push(`native_plan_${plan.id}_required`);
  } catch {
    issues.push("razorpay_account_review_required");
  }
  try {
    const policy = lifecyclePolicySchema.parse(
      JSON.parse(env.SUBSCRIPTION_LIFECYCLE_POLICY ?? "null"),
    );
    if (
      policy.mode !== "live" ||
      new Date(policy.effectiveFrom) > at ||
      new Date(policy.effectiveUntil) <= at ||
      policy.cancellationTiming !== "cycle_end" ||
      policy.cancellationAccess !== "paid_through"
    )
      issues.push("live_cancellation_policy_required");
  } catch {
    issues.push("live_cancellation_policy_required");
  }
  if (
    !env.TRIGGER_SECRET_KEY?.startsWith("tr_prod_") ||
    !env.TRIGGER_PROJECT_REF ||
    !env.TRIGGER_PAYMENT_RECOVERY_CRON ||
    !env.TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON ||
    !env.TRIGGER_PRODUCTION_DEPLOYMENT_VERSION
  )
    issues.push("production_workers_required");
  return issues;
}
