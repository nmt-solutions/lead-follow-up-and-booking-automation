import type { FinancialGateway } from "../models/financial-adjustments";
import type { PaymentSnapshot } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";

export function financialAccounts(gateway: FinancialGateway) {
  return [gateway, ...(gateway.accounts ?? [])];
}
export function financialAccount(
  gateway: FinancialGateway,
  source: PaymentSnapshot["provider"],
) {
  const matches = financialAccounts(gateway).filter(
    (g) =>
      source.key === "razorpay" &&
      g.account === source.account &&
      g.mode === source.mode,
  );
  if (matches.length !== 1) throw new ApplicationError("SETUP_REQUIRED");
  return matches[0];
}
