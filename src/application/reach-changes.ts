import { publicPaymentSnapshot } from "../subscription-payments/projection";
import { z } from "zod";
import type { Actor, Clock } from "../models/business";
import { businessIdSchema } from "../models/business";
import { ApplicationError } from "../models/application-error";
import {
  previewReachSchema,
  reachCommandSchema,
  reachApprovalSchema,
  reachFactSchema,
  reachCheckoutRequestSchema,
  reachCheckoutSchema,
  ReachEffectNotAttempted,
  type ReachPolicy,
  type ReachWork,
  type ReachStage,
  type ReachChange,
} from "../models/reach-changes";
import type {
  PaymentGateway,
  PaymentSnapshot,
} from "../models/subscription-payments";
import type { createReachChangeRepository } from "../db/reach-change-repository";

function parse<T>(schema: z.ZodType<T>, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApplicationError("INVALID_INPUT");
  return result.data;
}
function publicFinancial(snapshot: PaymentSnapshot): PaymentSnapshot {
  return publicPaymentSnapshot(snapshot);
}
/** Public agreement copies omit deployment reviews; persisted work and its hash stay full. */
function publicChange(change: ReachChange): ReachChange {
  const s = change.snapshot;
  return {
    ...change,
    snapshot: {
      ...s,
      currentFinancial: publicFinancial(s.currentFinancial),
      original: {
        ...s.original,
        snapshot: publicFinancial(s.original.snapshot),
      },
      action: {
        ...s.action,
        snapshot: publicFinancial(s.action.snapshot),
        ...(s.action.reachRenewals
          ? {
              reachRenewals: s.action.reachRenewals.map((r) => ({
                ...r,
                target: publicFinancial(r.target),
              })),
            }
          : {}),
      },
      target: publicFinancial(s.target),
      delta: publicFinancial(s.delta),
    },
  };
}
export function createReachChangeApplication<C>(d: {
  authenticate(credentials: C): Promise<Actor>;
  authenticatePlatform(credentials: C): Promise<Actor>;
  repository: ReturnType<typeof createReachChangeRepository>;
  gateway: PaymentGateway;
  policy?: ReachPolicy;
  clock: Clock;
}) {
  async function observe(work: ReachWork) {
    if (!d.gateway.reach) throw new ApplicationError("SETUP_REQUIRED");
    const change = await d.repository.readWork(work);
    try {
      await d.repository.observe(
        work,
        parse(reachFactSchema, await d.gateway.reach.inspect(change)),
        d.clock.now(),
      );
    } catch (error: unknown) {
      await d.repository.observationIssue(
        work,
        error instanceof ApplicationError &&
          error.code === "INVALID_PROVIDER_RESPONSE"
          ? "native_evidence_conflict"
          : "native_read_unavailable",
        d.clock.now(),
      );
      await d.repository.checked(work, d.clock.now());
      return d.repository.readWork(work);
    }
    await d.repository.linkReplacement(work, d.clock.now());
    await d.repository.checked(work, d.clock.now());
    return d.repository.apply(work, d.clock.now(), d.gateway, d.policy);
  }
  function stage(change: ReachChange): ReachStage | null {
    if (change.events.some((e) => e.fact.kind === "applied")) return null;
    const native = change.events.filter((e) => e.fact.native).at(-1)
      ?.fact.native;
    if (change.snapshot.path === "international_native")
      return native?.updated ? null : "update";
    if (!native?.oldStopped) return "stop_old";
    if (!native.subscriptionId) return "mandate";
    if (
      change.snapshot.direction === "expansion" &&
      !native.orderId &&
      native.mandateReady
    )
      return "order";
    return null;
  }
  async function refresh(
    credentials: C,
    businessId: unknown,
    value: unknown,
    operator = false,
    execute = false,
  ) {
    const id = parse(businessIdSchema, businessId),
      input = parse(reachCommandSchema, value),
      authenticate = operator ? d.authenticatePlatform : d.authenticate;
    const work = await d.repository.authorize(
      await authenticate(credentials),
      id,
      input,
      d.clock.now(),
      execute ? "execute" : "refresh",
      operator,
    );
    let change = await observe(work);
    if (execute)
      for (let count = 0; count < 3; count++) {
        const next = stage(change);
        if (!next) break;
        if (!d.gateway.reach) throw new ApplicationError("SETUP_REQUIRED");
        const began = await d.repository.begin(
          await authenticate(credentials),
          id,
          input.changeId,
          next,
          d.clock.now(),
          d.gateway,
          d.policy,
          operator,
        );
        if (!began) break;
        if (next === "mandate")
          await d.repository.prepareReplacement(work, d.clock.now());
        change = await d.repository.readWork(work);
        try {
          const fact = parse(
            reachFactSchema,
            await d.gateway.reach.effect(change, next, async () => {
              await d.repository.finalGate(
                await authenticate(credentials),
                id,
                input.changeId,
                d.clock.now(),
                d.gateway,
                d.policy,
                operator,
              );
            }),
          );
          await d.repository.observe(work, fact, d.clock.now());
        } catch (error: unknown) {
          if (error instanceof ReachEffectNotAttempted)
            await d.repository.preflightStopped(work, next, d.clock.now());
          else
            await d.repository.observationIssue(
              work,
              "native_outcome_unknown",
              d.clock.now(),
            );
          break;
        }
        change = await observe(work);
      }
    return publicChange(
      await d.repository.read(
        await authenticate(credentials),
        id,
        input.changeId,
        operator,
      ),
    );
  }
  return {
    async withdraw(credentials: C, businessId: unknown, value: unknown) {
      return publicChange(
        await d.repository.withdraw(
          await d.authenticate(credentials),
          parse(businessIdSchema, businessId),
          parse(reachCommandSchema, value),
          d.clock.now(),
        ),
      );
    },
    async workspace(credentials: C, businessId: unknown) {
      const state = await d.repository.workspace(
        await d.authenticate(credentials),
        parse(businessIdSchema, businessId),
        d.clock.now(),
      );
      const p = d.policy,
        at = d.clock.now();
      const reasons = [
        ...(state.stopped ? ["business_offboarding_stop"] : []),
        ...(!d.gateway.reach ? ["native_card_adapter_required"] : []),
        ...(!p ? ["reviewed_reach_policy_required"] : []),
        ...(p?.inFlightUnengaged === "unknown"
          ? ["unengaged_campaign_disposition_required"]
          : []),
        ...(p &&
        (p.mode !== d.gateway.mode ||
          new Date(p.effectiveFrom) > at ||
          new Date(p.effectiveUntil) <= at)
          ? ["effective_matching_policy_required"]
          : []),
        ...(d.gateway.readiness?.() ?? []),
      ];
      return {
        ...state,
        changes: state.changes.map(publicChange),
        configuration: { ready: !reasons.length, reasons },
      };
    },
    async checkout(credentials: C, businessId: unknown, value: unknown) {
      const id = parse(businessIdSchema, businessId),
        input = parse(reachCheckoutRequestSchema, value),
        work = await d.repository.authorize(
          await d.authenticate(credentials),
          id,
          input,
          d.clock.now(),
          input.purpose === "mandate" ? "checkout_mandate" : "checkout_delta",
        );
      await observe(work);
      const change = await d.repository.read(
        await d.authenticate(credentials),
        id,
        input.changeId,
      );
      await d.repository.finalGate(
        await d.authenticate(credentials),
        id,
        input.changeId,
        d.clock.now(),
        d.gateway,
        d.policy,
      );
      if (!d.gateway.reach?.checkout)
        throw new ApplicationError("SETUP_REQUIRED");
      return parse(
        reachCheckoutSchema,
        d.gateway.reach.checkout(change, input.purpose),
      );
    },
    async queue(credentials: C) {
      const state = await d.repository.queue(
        await d.authenticatePlatform(credentials),
      );
      return { ...state, changes: state.changes.map(publicChange) };
    },
    async approve(credentials: C, businessId: unknown, value: unknown) {
      return publicChange(
        await d.repository.approve(
          await d.authenticate(credentials),
          parse(businessIdSchema, businessId),
          parse(reachApprovalSchema, value),
          d.clock.now(),
          d.gateway,
          d.policy,
        ),
      );
    },
    execute: (credentials: C, businessId: unknown, value: unknown) =>
      refresh(credentials, businessId, value, false, true),
    refresh: (credentials: C, businessId: unknown, value: unknown) =>
      refresh(credentials, businessId, value),
    operatorExecute: (credentials: C, businessId: unknown, value: unknown) =>
      refresh(credentials, businessId, value, true, true),
    operatorRefresh: (credentials: C, businessId: unknown, value: unknown) =>
      refresh(credentials, businessId, value, true),
    async recover() {
      const work = await d.repository.pending(d.gateway);
      for (const item of work) await observe(item);
      return { reconciled: work.length };
    },
    async preview(credentials: C, businessId: unknown, value: unknown) {
      const id = parse(businessIdSchema, businessId),
        change = await d.repository.preview(
          await d.authenticate(credentials),
          id,
          parse(previewReachSchema, value),
          d.clock.now(),
          d.gateway,
          d.policy,
        );
      if (change.events.some((e) => e.fact.kind === "approved"))
        return publicChange(change);
      if (!d.gateway.reach) throw new ApplicationError("SETUP_REQUIRED");
      const work = await d.repository.previewWork(
        await d.authenticate(credentials),
        id,
        change.id,
      );
      await d.repository.observe(
        work,
        parse(reachFactSchema, await d.gateway.reach.inspect(change)),
        d.clock.now(),
      );
      await d.repository.finalGate(
        await d.authenticate(credentials),
        id,
        change.id,
        d.clock.now(),
        d.gateway,
        d.policy,
      );
      return publicChange(
        await d.repository.read(
          await d.authenticate(credentials),
          id,
          change.id,
        ),
      );
    },
  };
}
