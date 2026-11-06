import type { PaymentGateway } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";

/** Native Razorpay composition is #45. Replacing this adapter enables the same persisted workflow;
 * no permanent false readiness condition is imposed by the application. */
export function configuredPayments(): PaymentGateway {
  const unavailable = async (): Promise<never> => {
    throw new ApplicationError("SETUP_REQUIRED");
  };
  return {
    key: "razorpay",
    account: "unconfigured",
    mode: "unconfigured",
    supports: () => false,
    create: unavailable,
    authenticateEvent: unavailable,
    reconcile: unavailable,
  };
}
