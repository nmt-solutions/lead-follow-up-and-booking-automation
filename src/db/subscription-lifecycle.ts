import { isDeepStrictEqual } from "node:util";
import { randomUUID, createHash } from "node:crypto";
import { eq, asc, and, sql } from "drizzle-orm";
import {
  subscriptionPayment,
  subscriptionPeriod,
  subscriptionLifecycleEvent,
} from "./schema";
import type { Transaction } from "./scope";
import {
  effectiveLifecyclePolicy,
  type LifecycleObservation,
  type LifecyclePolicy,
  type SubscriptionLifecycle,
  type LifecycleEvent,
} from "../models/subscription-lifecycle";
import { ApplicationError } from "../models/application-error";

type Row = typeof subscriptionPayment.$inferSelect;
export async function appendLifecycleEvent(
  tx: Transaction,
  row: Row,
  lifecycle: SubscriptionLifecycle,
  kind: string,
  key: string,
  at: Date,
  actorId: string | null = null,
  notice: LifecycleEvent["notice"] = null,
) {
  await tx
    .insert(subscriptionLifecycleEvent)
    .values({
      id: randomUUID(),
      businessId: row.businessId,
      actionId: row.id,
      key,
      kind,
      actorId,
      at,
      lifecycle,
      notice,
    })
    .onConflictDoNothing();
}
export async function reconcileLifecycle(
  tx: Transaction,
  row: Row,
  at: Date,
  configured?: LifecyclePolicy,
  observation?: LifecycleObservation,
  cancellationAcknowledged = false,
) {
  const previous = row.lifecycle;
  const periods = await tx
    .select()
    .from(subscriptionPeriod)
    .where(eq(subscriptionPeriod.actionId, row.id))
    .orderBy(asc(subscriptionPeriod.end));
  const paidThrough = periods.at(-1)?.end.toISOString() ?? null;
  const policy = effectiveLifecyclePolicy(
    configured,
    row.snapshot.provider.mode,
    at,
  );
  if (
    policy &&
    previous?.policy?.id === policy.id &&
    previous.policy.version === policy.version &&
    !isDeepStrictEqual(previous.policy, policy)
  )
    throw new ApplicationError("CONFLICT");
  if (policy) {
    const history = await tx
      .select({ lifecycle: subscriptionLifecycleEvent.lifecycle })
      .from(subscriptionLifecycleEvent)
      .where(
        and(
          eq(subscriptionLifecycleEvent.actionId, row.id),
          sql`${subscriptionLifecycleEvent.lifecycle}->'policy'->>'id'=${policy.id}`,
          sql`${subscriptionLifecycleEvent.lifecycle}->'policy'->>'version'=${String(policy.version)}`,
        ),
      );
    if (
      history.some(
        (event) => !isDeepStrictEqual(event.lifecycle.policy, policy),
      )
    )
      throw new ApplicationError("CONFLICT");
  }
  if (
    observation &&
    (observation.provider !== row.snapshot.provider.key ||
      observation.account !== row.snapshot.provider.account ||
      observation.operationKey !== row.operationKey ||
      observation.subscriptionId !== row.checkout?.subscriptionId ||
      new Date(observation.observedAt) > at ||
      (observation.endedAt && new Date(observation.endedAt) > at))
  )
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  // A cancelled native subscription cannot restart. Receipts are hints; only bound native reads reach here.
  const terminal = (s: string | undefined) =>
    ["cancelled", "completed", "expired"].includes(s ?? "");
  const oldProvider = previous?.provider;
  const provider: LifecycleObservation | null =
    (terminal(oldProvider?.status)
      ? observation?.status === oldProvider?.status && !oldProvider?.endedAt
        ? observation
        : oldProvider
      : observation &&
          (!oldProvider ||
            new Date(observation.observedAt) >=
              new Date(oldProvider.observedAt))
        ? observation
        : oldProvider) ?? null;
  let failedThrough =
    previous?.failedThrough === paidThrough ? paidThrough : null;
  if (
    paidThrough &&
    ["pending", "halted"].includes(provider?.status ?? "") &&
    (provider?.currentEnd === paidThrough ||
      provider?.unpaidPeriodStart === paidThrough)
  )
    failedThrough = paidThrough;
  let cancellation = previous?.cancellation ?? null;
  if (
    cancellation?.status === "confirmed" &&
    terminal(provider?.status) &&
    provider?.endedAt &&
    cancellation.effectiveEnd &&
    new Date(provider.endedAt) < new Date(cancellation.effectiveEnd)
  ) {
    cancellation = { ...cancellation, effectiveEnd: provider.endedAt };
  }
  if (
    cancellation &&
    cancellation.status === "requested" &&
    (cancellationAcknowledged || terminal(provider?.status))
  ) {
    const end = terminal(provider?.status)
      ? provider?.endedAt
      : cancellation.timing === "cycle_end"
        ? provider?.currentEnd
        : at.toISOString();
    if (end)
      cancellation = {
        ...cancellation,
        status: "confirmed",
        confirmedAt: at.toISOString(),
        effectiveEnd: end,
      };
  }
  // Provider-origin cancellation is separately attributable and also needs reviewed access policy.
  if (
    !cancellation &&
    terminal(provider?.status) &&
    provider?.endedAt &&
    policy
  )
    cancellation = {
      requestKey: randomUUID(),
      requestedAt: provider.endedAt,
      actorId: "provider",
      timing: "immediate",
      access: policy.cancellationAccess,
      paidThroughAtRequest: paidThrough,
      status: "confirmed",
      confirmedAt: at.toISOString(),
      effectiveEnd: provider.endedAt,
    };
  const graceEnd =
    failedThrough &&
    policy &&
    cancellation?.status !== "confirmed" &&
    !terminal(provider?.status)
      ? new Date(
          new Date(failedThrough).getTime() + policy.graceSeconds * 1000,
        ).toISOString()
      : null;
  const state: SubscriptionLifecycle["state"] =
    terminal(provider?.status) ||
    (cancellation?.status === "confirmed" &&
      cancellation.effectiveEnd &&
      new Date(cancellation.effectiveEnd) <= at)
      ? "cancelled"
      : !paidThrough
        ? "pending"
        : failedThrough || new Date(paidThrough) <= at
          ? "past_due"
          : "active";
  const available = periods.some(
    (p) =>
      p.start <= at &&
      p.end > at &&
      !(
        cancellation?.status === "confirmed" &&
        cancellation.effectiveEnd &&
        ((cancellation.access === "provider_end" &&
          at >= new Date(cancellation.effectiveEnd)) ||
          (cancellation.timing === "cycle_end"
            ? p.start >= new Date(cancellation.effectiveEnd)
            : p.start > new Date(cancellation.effectiveEnd)) ||
          (p.charge?.paidAt &&
            new Date(p.charge.paidAt) > new Date(cancellation.effectiveEnd)))
      ),
  );
  const accessState = available
    ? "paid"
    : graceEnd &&
        new Date(graceEnd) > at &&
        policy?.graceAccess === "remaining_allowance"
      ? "grace"
      : "blocked";
  const lifecycle: SubscriptionLifecycle = {
    state,
    accessState,
    paidThrough,
    failedThrough,
    graceEnd,
    policy,
    provider,
    cancellation,
    reason: !policy ? "lifecycle_policy_required" : null,
    evaluatedAt: at.toISOString(),
  };
  const visible = (value: SubscriptionLifecycle) => ({
    ...value,
    evaluatedAt: "",
    provider: value.provider ? { ...value.provider, observedAt: "" } : null,
  });
  if (!previous || !isDeepStrictEqual(visible(previous), visible(lifecycle))) {
    const kind: NonNullable<LifecycleEvent["notice"]>["kind"] | null =
      cancellation?.status === "confirmed" &&
      previous?.cancellation?.status !== "confirmed"
        ? "cancellation_confirmed"
        : state === "active" && previous?.state === "past_due"
          ? "payment_recovered"
          : previous?.accessState &&
              previous.accessState !== "blocked" &&
              accessState === "blocked"
            ? "access_ended"
            : state !== previous?.state
              ? state === "past_due"
                ? "payment_failed"
                : state === "active"
                  ? "payment_active"
                  : state === "pending"
                    ? "payment_pending"
                    : "cancellation_confirmed"
              : null;
    const stable = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(stable)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, stable(v)]),
            )
          : value;
    const key = createHash("sha256")
      .update(JSON.stringify(stable(visible(lifecycle))))
      .digest("hex");
    await appendLifecycleEvent(
      tx,
      row,
      lifecycle,
      "lifecycle_reconciled",
      key,
      at,
      null,
      kind ? { kind, channel: "in_app", status: "available" } : null,
    );
  }
  await tx
    .update(subscriptionPayment)
    .set({ lifecycle })
    .where(eq(subscriptionPayment.id, row.id));
  return lifecycle;
}
