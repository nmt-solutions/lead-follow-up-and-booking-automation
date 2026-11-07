import { publicFinancialValue } from "../models/public-financial";
import { paymentSnapshotSchema } from "../models/subscription-payments";
import { publicTaxCalculation } from "../tax/projection";
import type {
  PaymentAction,
  PaymentSnapshot,
  PaymentWorkspace,
} from "../models/subscription-payments";
/** Preserve the private financial record. Selected-Business responses contain no deployment-wide merchant review. */
export function publicPaymentSnapshot(
  snapshot: PaymentSnapshot,
): PaymentSnapshot {
  const projected = paymentSnapshotSchema.parse(publicFinancialValue(snapshot));
  return { ...projected, tax: publicTaxCalculation(snapshot.tax) };
}
export function publicPaymentAction(action: PaymentAction): PaymentAction {
  const {
    settledCaptures: ignoredCaptures,
    settledPaymentIds: ignoredIds,
    ...visible
  } = action;
  void ignoredCaptures;
  void ignoredIds;
  const review = action.snapshot.provider.review;
  const plan = review?.plans.find(
    (p) =>
      p.offerId === action.snapshot.quote.selection.offerId &&
      p.reservedCapacityId ===
        action.snapshot.quote.selection.reservedCapacityId &&
      p.currency === action.snapshot.quote.currency,
  );
  return {
    ...visible,
    snapshot: publicPaymentSnapshot(action.snapshot),
    reachRenewals: action.reachRenewals?.map((r) => ({
      ...r,
      target: publicPaymentSnapshot(r.target),
    })),
    ...(review && plan
      ? { nativeTerms: { planId: plan.planId, totalCount: plan.totalCount } }
      : {}),
  };
}
export function publicPaymentWorkspace(
  workspace: PaymentWorkspace,
): PaymentWorkspace {
  const { review: ignored, ...gateway } = workspace.gateway;
  void ignored;
  const period = (p: PaymentWorkspace["periods"][number]) => ({
    ...p,
    snapshot: publicPaymentSnapshot(p.snapshot),
  });
  return {
    ...workspace,
    gateway,
    actions: workspace.actions.map(publicPaymentAction),
    periods: workspace.periods.map(period),
    access: {
      ...workspace.access,
      period: workspace.access.period ? period(workspace.access.period) : null,
    },
  };
}
