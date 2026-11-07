import { z } from "zod";
import {
  adjustmentPolicySchema,
  type FinancialGateway,
} from "../models/financial-adjustments";
import { razorpayAccountReviewSchema } from "../models/razorpay-account";
import { createRazorpayAdjustments } from "./razorpay";
import type { Clock } from "../models/business";
import { ApplicationError } from "../models/application-error";

export function configuredFinancialAdjustments(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    clock?: Clock;
  } = {},
): FinancialGateway {
  const env = options.env ?? process.env;
  let policy = null;
  try {
    policy = adjustmentPolicySchema.parse(
      JSON.parse(env.FINANCIAL_ADJUSTMENT_POLICY ?? "null"),
    );
  } catch {
    /* Missing policy blocks new actions. */
  }
  try {
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(env.RAZORPAY_ACCOUNT_REVIEW ?? "null"),
    );
    const keyId = z
        .string()
        .startsWith(`rzp_${review.mode}_`)
        .parse(env.RAZORPAY_KEY_ID),
      secret = z.string().min(1).parse(env.RAZORPAY_KEY_SECRET);
    const webhookSecrets = z
      .array(z.string().min(1))
      .min(1)
      .max(3)
      .parse(JSON.parse(env.RAZORPAY_WEBHOOK_SECRETS ?? "null"));
    return createRazorpayAdjustments({
      review,
      keyId,
      secret,
      policy,
      webhookSecrets,
      fetch: options.fetch ?? fetch,
      clock: options.clock ?? { now: () => new Date() },
    });
  } catch {
    /* Invalid deployment configuration stays unavailable. */
  }
  const unavailable = async (): Promise<never> => {
    throw new ApplicationError("SETUP_REQUIRED");
  };
  return {
    account: "unconfigured",
    mode: "unconfigured",
    policy,
    validate: unavailable,
    refund: unavailable,
    poll: unavailable,
    prepareDispute: unavailable,
    dispute: unavailable,
    confirmDispute: unavailable,
    authenticateEvent: unavailable,
  };
}
