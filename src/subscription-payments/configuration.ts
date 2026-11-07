import type { PaymentGateway } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import { razorpayAccountReviewSchema } from "../models/razorpay-account";
import { createRazorpayGateway } from "./razorpay";
import { lifecyclePolicySchema } from "../models/subscription-lifecycle";
import { reachPolicySchema } from "../models/reach-changes";

export function configuredReachPolicy(
  env: Record<string, string | undefined> = process.env,
) {
  try {
    return reachPolicySchema.parse(
      JSON.parse(env.SUBSCRIPTION_REACH_POLICY ?? "null"),
    );
  } catch {
    return undefined;
  }
}

/** Both web and Trigger compose native cards and the independently reviewed lifecycle policy. */
export function configuredPayments(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    clock?: Clock;
  } = {},
): PaymentGateway {
  const unavailable = async (): Promise<never> => {
    throw new ApplicationError("SETUP_REQUIRED");
  };
  const env = options.env ?? process.env;
  try {
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(env.RAZORPAY_ACCOUNT_REVIEW ?? "null"),
    );
    const keyId = env.RAZORPAY_KEY_ID,
      secret = env.RAZORPAY_KEY_SECRET;
    const secrets: unknown = JSON.parse(env.RAZORPAY_WEBHOOK_SECRETS ?? "null");
    if (
      !keyId?.startsWith(`rzp_${review.mode}_`) ||
      !secret ||
      !Array.isArray(secrets) ||
      secrets.length === 0 ||
      secrets.length > 3 ||
      !secrets.every((s): s is string => typeof s === "string" && s.length > 0)
    )
      throw new Error("configuration");
    const gateway = createRazorpayGateway({
      review,
      keyId,
      secret,
      webhookSecrets: secrets,
      fetch: options.fetch ?? fetch,
      clock: options.clock ?? { now: () => new Date() },
    });
    try {
      gateway.lifecyclePolicy = lifecyclePolicySchema.parse(
        JSON.parse(env.SUBSCRIPTION_LIFECYCLE_POLICY ?? "null"),
      );
    } catch {
      /* Missing policy blocks grace and cancellation, not payment capture reconciliation. */
    }
    return gateway;
  } catch {
    /* Invalid deployment configuration stays visibly unavailable. */
  }
  return {
    key: "razorpay",
    account: "unconfigured",
    mode: "unconfigured",
    readiness: () => ["native_account_configuration_required"],
    supports: () => false,
    create: unavailable,
    authenticateEvent: unavailable,
    reconcile: unavailable,
  };
}
