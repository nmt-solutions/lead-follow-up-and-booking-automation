import { z } from "zod";
import {
  checkoutReferenceSchema,
  type CheckoutReference,
} from "@/models/subscription-payments";
import { loadNativeCheckout } from "./razorpay-recovery";
export async function openPilotCheckout(
  input: CheckoutReference,
  confirmed: (value: {
    orderId: string;
    paymentId: string;
    signature: string;
  }) => void,
  dismissed: () => void,
) {
  const checkout = checkoutReferenceSchema.parse(input).standard;
  if (!checkout) throw new Error("Pilot checkout needs a saved server order.");
  await loadNativeCheckout(checkout.script);
  if (!window.Razorpay) throw new Error("Secure card checkout is unavailable.");
  new window.Razorpay({
    key: checkout.key,
    order_id: checkout.order_id,
    customer_id: checkout.customer_id,
    amount: checkout.amount,
    currency: checkout.currency,
    handler: (value: unknown) => {
      const result = z
        .object({
          razorpay_order_id: z.string(),
          razorpay_payment_id: z.string(),
          razorpay_signature: z.string(),
        })
        .safeParse(value);
      if (result.success)
        confirmed({
          orderId: result.data.razorpay_order_id,
          paymentId: result.data.razorpay_payment_id,
          signature: result.data.razorpay_signature,
        });
      else dismissed();
    },
    modal: { ondismiss: dismissed },
  }).open();
}
