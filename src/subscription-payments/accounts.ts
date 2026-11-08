import type {
  PaymentGateway,
  PaymentSnapshot,
} from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";

export function paymentAccounts(gateway: PaymentGateway) {
  return [gateway, ...(gateway.accounts ?? [])];
}
/** Frozen source identity selects credentials. Payload account IDs never select a secret. */
export function paymentAccount(
  gateway: PaymentGateway,
  source: PaymentSnapshot["provider"],
) {
  const matches = paymentAccounts(gateway).filter(
    (g) =>
      g.key === source.key &&
      g.account === source.account &&
      g.mode === source.mode,
  );
  if (matches.length !== 1) throw new ApplicationError("SETUP_REQUIRED");
  return matches[0];
}
