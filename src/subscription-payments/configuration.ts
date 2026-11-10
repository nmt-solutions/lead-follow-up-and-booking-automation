import type { PaymentGateway } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import { razorpayAccountReviewSchema } from "../models/razorpay-account";
import { createRazorpayGateway } from "./razorpay";
import { lifecyclePolicySchema } from "../models/subscription-lifecycle";
import { reachPolicySchema } from "../models/reach-changes";
import { paymentAccount } from "./accounts";
import { upiSandboxVerifier } from "./upi-sandbox";

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
function configuredSinglePayments(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    clock?: Clock;
  } = {},
  path: "card" | "upi" = "card",
): PaymentGateway {
  const unavailable = async (): Promise<never> => {
    throw new ApplicationError("SETUP_REQUIRED");
  };
  const env = options.env ?? process.env;
  try {
    const review = razorpayAccountReviewSchema.parse(
      JSON.parse(env.RAZORPAY_ACCOUNT_REVIEW ?? "null"),
    );
    if (env.NODE_ENV === "production" && review.mode !== "live")
      throw new Error("Live payment configuration required");
    if ((path === "upi") !== Boolean(review.upiPath))
      throw new Error("method path");
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

/** Account settings are isolated: adding UPI never changes the cards-only merchant. */
export function configuredPayments(
  options: {
    env?: Record<string, string | undefined>;
    fetch?: typeof fetch;
    clock?: Clock;
  } = {},
): PaymentGateway {
  const env = options.env ?? process.env;
  const card = configuredSinglePayments(options);
  if (!env.RAZORPAY_UPI_ACCOUNT_REVIEW) return card;
  const upi = configuredSinglePayments(
    {
      ...options,
      env: {
        ...env,
        RAZORPAY_ACCOUNT_REVIEW: env.RAZORPAY_UPI_ACCOUNT_REVIEW,
        RAZORPAY_KEY_ID: env.RAZORPAY_UPI_KEY_ID,
        RAZORPAY_KEY_SECRET: env.RAZORPAY_UPI_KEY_SECRET,
        RAZORPAY_WEBHOOK_SECRETS: env.RAZORPAY_UPI_WEBHOOK_SECRETS,
      },
    },
    "upi",
  );
  if (upi.method !== "upi" || upi.account === card.account || !upi.review)
    return card;
  // Each selected adapter retains its own credentials and signed event key ring.
  const reviewed = upi.review;
  const keyId = env.RAZORPAY_UPI_KEY_ID!,
    secret = env.RAZORPAY_UPI_KEY_SECRET!;
  const selected = createRazorpayGateway({
    review: reviewed,
    keyId,
    secret,
    webhookSecrets: JSON.parse(env.RAZORPAY_UPI_WEBHOOK_SECRETS!),
    fetch: options.fetch ?? fetch,
    clock: options.clock ?? { now: () => new Date() },
    ...(reviewed.upiPath?.sandbox.kind === "native_sandbox" &&
    env.RAZORPAY_UPI_SANDBOX_KEY_ID?.startsWith("rzp_test_") &&
    env.RAZORPAY_UPI_SANDBOX_KEY_SECRET
      ? {
          verifySandbox: upiSandboxVerifier({
            review: reviewed,
            keyId: env.RAZORPAY_UPI_SANDBOX_KEY_ID,
            secret: env.RAZORPAY_UPI_SANDBOX_KEY_SECRET,
            fetch: options.fetch ?? fetch,
          }),
        }
      : {}),
    sourceRequest: (source, path, body, method) => {
      const gateway = paymentAccount(card, source);
      if (!gateway.nativeRequest) throw new ApplicationError("SETUP_REQUIRED");
      return gateway.nativeRequest(path, body, method);
    },
  });
  selected.lifecyclePolicy = upi.lifecyclePolicy;
  card.accounts = [selected];
  selected.accounts = [card];
  return card;
}
