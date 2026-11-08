import {
  reachCheckoutSchema,
  type ReachCheckout,
} from "@/models/reach-changes";
import { loadNativeCheckout } from "./razorpay-recovery";

/** Server-bound native identifiers only; callback payloads never establish payment. */
export async function openReachCheckout(
  input: ReachCheckout,
  reconciled: (proof?: unknown) => void,
  dismissed: () => void,
) {
  const checkout = reachCheckoutSchema.parse(input);
  await loadNativeCheckout(checkout.script);
  if (!window.Razorpay)
    throw new Error("Secure payment checkout is unavailable. Try again.");
  const options =
    checkout.kind === "mandate"
      ? {
          key: checkout.key,
          customer_id: checkout.customer_id,
          subscription_id: checkout.subscription_id,
        }
      : {
          key: checkout.key,
          customer_id: checkout.customer_id,
          order_id: checkout.order_id,
          amount: checkout.amount,
          currency: checkout.currency,
        };
  try {
    new window.Razorpay({
      ...options,
      handler: reconciled,
      modal: { ondismiss: dismissed },
    }).open();
  } catch {
    throw new Error("Unable to open secure payment checkout. Try again.");
  }
}
