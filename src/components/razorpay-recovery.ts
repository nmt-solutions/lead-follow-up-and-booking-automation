import type { z } from "zod";
import { recoveryCheckoutSchema } from "@/models/subscription-lifecycle";

type Recovery = z.infer<typeof recoveryCheckoutSchema>;
declare global {
  interface Window {
    Razorpay?: new (
      options: Omit<Recovery, "script"> & {
        handler(): void;
        modal: { ondismiss(): void };
      },
    ) => { open(): void };
  }
}
let loading: Promise<void> | undefined;
/** Only the exact native script and server-bound subscription input are accepted. Callback data is discarded. */
export async function openCardRecovery(
  input: Recovery,
  refreshed: () => void,
  dismissed: () => void,
) {
  const checkout = recoveryCheckoutSchema.parse(input);
  if (!window.Razorpay) {
    loading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = checkout.script;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        loading = undefined;
        reject(new Error("Unable to load secure card recovery. Try again."));
      };
      document.head.append(script);
    });
    await loading;
  }
  if (!window.Razorpay) {
    loading = undefined;
    throw new Error("Secure card recovery is unavailable. Try again.");
  }
  try {
    const native = new window.Razorpay({
      key: checkout.key,
      subscription_id: checkout.subscription_id,
      subscription_card_change: true,
      handler: refreshed,
      modal: { ondismiss: dismissed },
    });
    native.open();
  } catch {
    throw new Error("Unable to open secure card recovery. Try again.");
  }
}
