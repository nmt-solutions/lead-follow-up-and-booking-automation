import type {
  PaymentAction,
  PaymentSnapshot,
  PaymentWorkspace,
} from "../models/subscription-payments";
export function publicTaxCalculation(
  tax: PaymentSnapshot["tax"],
): PaymentSnapshot["tax"] {
  const revisions = new Set(tax.lines.map((l) => l.rule.revision.id));
  const decisions = new Set(tax.lines.map((l) => l.rule.approval.id));
  return {
    ...tax,
    configuration: {
      revisions: tax.configuration.revisions.filter((r) => revisions.has(r.id)),
      decisions: tax.configuration.decisions.filter((r) => decisions.has(r.id)),
    },
  };
}
/** Preserve the private financial record. Selected-Business responses contain no deployment-wide merchant review. */
export function publicPaymentSnapshot(
  snapshot: PaymentSnapshot,
): PaymentSnapshot {
  const { review: ignored, ...provider } = snapshot.provider;
  void ignored;
  return { ...snapshot, provider, tax: publicTaxCalculation(snapshot.tax) };
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
