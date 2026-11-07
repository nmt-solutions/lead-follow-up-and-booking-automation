import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  subscriptionPeriod,
  subscriptionPayment,
  subscriptionQuote,
  subscriptionPaymentEvent,
  reachChange,
  reachChangeEvent,
} from "./schema";
import { readBillingWorkspace } from "./billing-repository";
import { readPricingCatalog } from "./subscription-quote-repository";
import { appendTaxCalculation } from "./tax-repository";
import { evaluateTax } from "../application/tax-calculation";
import {
  subscriptionQuoteSchema,
  reviewSubscriptionQuote,
} from "../models/subscription-quotes";
import {
  paymentActionSchema,
  paidPeriodSchema,
  type PaymentGateway,
  type PaymentSnapshot,
} from "../models/subscription-payments";
import {
  reachPolicySchema,
  reachFraction,
  reachUnsent,
  reachChangeSchema,
  type ReachPolicy,
  type ReachSnapshot,
  type ReachFact,
  type ReachWork,
  type ReachStage,
} from "../models/reach-changes";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import { z } from "zod";
import {
  billingState,
  billingRevisionSchema,
  billingReviewSchema,
} from "../models/billing";
import { pricingRevisionSchema } from "../models/subscription-quotes";
import { taxCatalogSchema } from "../models/tax";
import { paidAllowance } from "./paid-access";

type Row = typeof reachChange.$inferSelect;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
async function view(tx: Transaction, row: Row) {
  const mandateEvents = await tx
    .select()
    .from(subscriptionPaymentEvent)
    .where(
      eq(subscriptionPaymentEvent.actionId, row.snapshot.replacementActionId),
    );
  const events = await tx
    .select()
    .from(reachChangeEvent)
    .where(eq(reachChangeEvent.changeId, row.id))
    .orderBy(asc(reachChangeEvent.position));
  const kinds = events.map((e) => e.fact.kind);
  const native = events.filter((e) => e.fact.native).at(-1)?.fact.native;
  const reviewHash = native
    ? createHash("sha256")
        .update(canonical({ snapshot: row.snapshot, native }))
        .digest("hex")
    : null;
  return reachChangeSchema.parse({
    mandatePayments: mandateEvents
      .filter(
        (e) =>
          e.observation.native?.event === "subscription.authenticated" &&
          e.observation.paymentId &&
          e.observation.subscriptionId,
      )
      .map((e) => ({
        paymentId: e.observation.paymentId,
        subscriptionId: e.observation.subscriptionId,
      })),
    ...row,
    at: row.at.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    reviewHash,
    state: kinds.includes("applied")
      ? "applied"
      : kinds.includes("withdrawn")
        ? "withdrawn"
        : kinds.includes("review")
          ? "review_required"
          : kinds.includes("attempt")
            ? "pending"
            : kinds.includes("approved")
              ? "approved"
              : "preview",
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
  });
}
function policyAt(policy: ReachPolicy | undefined, mode: string, at: Date) {
  const p = reachPolicySchema.safeParse(policy);
  if (
    !p.success ||
    p.data.mode !== mode ||
    new Date(p.data.checkedAt) > at ||
    new Date(p.data.effectiveFrom) > at ||
    new Date(p.data.effectiveUntil) <= at ||
    p.data.inFlightUnengaged === "unknown" ||
    (p.data.proration === "remaining_utc_days" && !p.data.utcDayCutoff)
  )
    throw new ApplicationError("SETUP_REQUIRED");
  return p.data;
}
async function targetQuote(
  tx: Transaction,
  businessId: string,
  quoteId: string,
  at: Date,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('subscription-pricing',0))`,
  );
  const [row] = await tx
    .select()
    .from(subscriptionQuote)
    .where(
      and(
        eq(subscriptionQuote.id, quoteId),
        eq(subscriptionQuote.businessId, businessId),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  const quote = subscriptionQuoteSchema.parse(row.snapshot);
  if (
    !reviewSubscriptionQuote(
      quote,
      await readBillingWorkspace(tx, businessId, at),
      (await readPricingCatalog(tx, at)).current,
    ).commercialReady ||
    quote.selection.term !== "monthly"
  )
    throw new ApplicationError("PRICING_SETUP_REQUIRED");
  return quote;
}
const round = (value: bigint, numerator: bigint, denominator: bigint) =>
  (value * numerator * 2n + denominator) / (denominator * 2n);
export function createReachChangeRepository(database: Database) {
  async function stopped(tx: Transaction, businessId: string) {
    const result = await tx.execute<{ stopped: boolean }>(
      sql`select public.business_data_stopped(${businessId}::uuid) stopped`,
    );
    return result.rows[0]?.stopped === true;
  }
  async function requireRunning(tx: Transaction, businessId: string) {
    if (await stopped(tx, businessId)) throw new ApplicationError("FORBIDDEN");
  }
  async function find(tx: Transaction, businessId: string, id: string) {
    const [row] = await tx
      .select()
      .from(reachChange)
      .where(
        and(eq(reachChange.id, id), eq(reachChange.businessId, businessId)),
      );
    if (!row) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  async function bind(tx: Transaction, row: Row) {
    await tx.execute(
      sql`select set_config('app.reach_change',${row.id},true),set_config('app.reach_capability',${row.recoveryKey},true)`,
    );
  }
  async function append(
    tx: Transaction,
    row: Row,
    key: string,
    fact: ReachFact,
    at: Date,
    actorId: string | null = null,
  ) {
    const [prior] = await tx
      .select()
      .from(reachChangeEvent)
      .where(
        and(
          eq(reachChangeEvent.businessId, row.businessId),
          ...(key.startsWith("request:")
            ? []
            : [eq(reachChangeEvent.changeId, row.id)]),
          eq(reachChangeEvent.key, key),
        ),
      );
    if (prior) {
      if (
        prior.changeId !== row.id ||
        prior.actorId !== actorId ||
        !isDeepStrictEqual(prior.fact, fact)
      )
        throw new ApplicationError("CONFLICT");
      return;
    }
    await tx.insert(reachChangeEvent).values({
      id: randomUUID(),
      businessId: row.businessId,
      changeId: row.id,
      key,
      fact,
      actorId,
      at,
    });
  }
  async function current(
    tx: Transaction,
    row: Row,
    at: Date,
    gateway: PaymentGateway,
    policy?: ReachPolicy,
    renewal = false,
  ) {
    await requireRunning(tx, row.businessId);
    if (
      !isDeepStrictEqual(
        policyAt(policy, gateway.mode, at),
        row.snapshot.policy,
      ) ||
      !isDeepStrictEqual(gateway.review, row.snapshot.target.provider.review) ||
      gateway.account !== row.snapshot.target.provider.account ||
      gateway.readiness?.().length
    )
      throw new ApplicationError("SETUP_REQUIRED");
    const raw = z
      .object({
        action: z.record(z.string(), z.unknown()),
        pricing: z.array(z.record(z.string(), z.unknown())),
        billing: z.object({
          history: z.array(z.record(z.string(), z.unknown())),
          reviews: z.array(z.record(z.string(), z.unknown())),
          files: z.array(
            z.object({
              id: z.string(),
              state: z.string(),
              sha256: z.string().nullable(),
              retentionUntil: z.string(),
            }),
          ),
          revisions: z.array(z.record(z.string(), z.unknown())),
          decisions: z.array(z.record(z.string(), z.unknown())),
        }),
      })
      .parse(
        (
          await tx.execute<{ context: unknown }>(
            sql`select public.reach_current_context(${row.id}::uuid,${row.businessId}::uuid) as context`,
          )
        ).rows[0]?.context,
      );
    const camel = (r: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_s, l: string) => l.toUpperCase()),
          ["at", "effective_from"].includes(k) && typeof v === "string"
            ? new Date(v).toISOString()
            : v,
        ]),
      );
    const billing = billingState(
      raw.billing.history.map((r) => billingRevisionSchema.parse(camel(r))),
      raw.billing.reviews.map((r) => billingReviewSchema.parse(camel(r))),
    );
    for (const e of billing.current?.evidence ?? []) {
      const f = raw.billing.files.find((f) => f.id === e.fileId);
      if (
        !f ||
        f.state !== "ready" ||
        f.sha256 !== e.sha256 ||
        new Date(f.retentionUntil) <= at
      ) {
        billing.status = "missing";
        billing.issues.push("evidence_unavailable");
      }
    }
    const pricing =
      raw.pricing
        .map((r) => pricingRevisionSchema.parse(camel(r)))
        .filter((p) => new Date(p.effectiveFrom) <= at)
        .at(-1) ?? null;
    if (
      !reviewSubscriptionQuote(row.snapshot.target.quote, billing, pricing)
        .commercialReady
    )
      throw new ApplicationError("PRICING_SETUP_REQUIRED");
    const configuration = taxCatalogSchema.parse({
      revisions: raw.billing.revisions.map(camel),
      decisions: raw.billing.decisions.map(camel),
    });
    for (const financial of [row.snapshot.target, row.snapshot.delta]) {
      const calculated = evaluateTax(
        financial.tax.input,
        billing,
        configuration,
        at,
        gateway.mode === "live" ? "live" : "fixture",
      );
      if (
        calculated.status !== "calculated" ||
        !isDeepStrictEqual(calculated.lines, financial.tax.lines) ||
        !isDeepStrictEqual(calculated.totals, financial.tax.totals)
      )
        throw new ApplicationError("SETUP_REQUIRED");
    }
    const action = paymentActionSchema.parse(camel(raw.action));
    const expectedReplacementStop =
      renewal &&
      row.snapshot.path === "replacement_mandate" &&
      action.lifecycle?.state === "cancelled" &&
      action.lifecycle.provider?.status === "cancelled" &&
      action.lifecycle.provider.subscriptionId ===
        row.snapshot.action.checkout?.subscriptionId &&
      action.lifecycle.provider.endedAt === row.snapshot.renewalAt &&
      (!action.lifecycle.cancellation ||
        (action.lifecycle.cancellation.actorId === "provider" &&
          action.lifecycle.cancellation.effectiveEnd ===
            row.snapshot.renewalAt)) &&
      (await view(tx, row)).events.some((e) => e.fact.native?.oldStopped);
    if (
      !action ||
      ((action.lifecycle?.cancellation ||
        action.lifecycle?.state === "cancelled") &&
        !expectedReplacementStop) ||
      action.state !== "confirmed"
    )
      throw new ApplicationError("CONFLICT");
    if (!renewal) {
      if (
        row.snapshot.path === "international_native" &&
        row.snapshot.direction === "expansion" &&
        row.snapshot.policy.proration === "remaining_calendar_seconds"
      ) {
        const difference = BigInt(
            row.snapshot.target.quote.renewal.subtotalMinor -
              row.snapshot.currentFinancial.quote.renewal.subtotalMinor,
          ),
          remaining = BigInt(
            Math.max(
              0,
              new Date(row.snapshot.renewalAt).getTime() - at.getTime(),
            ),
          ),
          duration = BigInt(
            new Date(row.snapshot.original.end).getTime() -
              new Date(row.snapshot.original.start).getTime(),
          );
        if (
          round(difference, remaining, duration) !==
          BigInt(row.snapshot.delta.tax.totals!.netMinor)
        )
          throw new ApplicationError("CONFLICT");
      }
      const eligible = await tx.execute<{ id: string }>(
        sql`select id from public.current_paid_scope(${row.businessId}::uuid,${at.toISOString()}::timestamptz)`,
      );
      if (
        eligible.rows[0]?.id !== row.periodId ||
        row.snapshot.original.end <= at.toISOString()
      )
        throw new ApplicationError("PAID_ACCESS_REQUIRED");
      const effective = await tx.execute<{
        basis: { changeId: string } | null;
      }>(
        sql`select public.reach_effective_scope(${row.businessId}::uuid,${row.periodId}::uuid,${at.toISOString()}::timestamptz) as basis`,
      );
      if (
        (effective.rows[0]?.basis?.changeId ?? null) !==
        row.snapshot.priorChangeId
      )
        throw new ApplicationError("PAID_ACCESS_REQUIRED");
    }
  }
  async function authorized<T>(
    actor: Actor,
    businessId: string,
    id: string,
    operation: (tx: Transaction, row: Row) => Promise<T>,
    operator = false,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        if (operator) {
          const result = await tx.execute<{ allowed: boolean }>(
            sql`select exists(select 1 from public.platform_operator where user_id=${actor.userId} and reconciliation) as allowed`,
          );
          if (!result.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
        } else await requireCapability(tx, actor, businessId, "billing.manage");
        const row = await find(tx, businessId, id);
        await bind(tx, row);
        return operation(tx, row);
      },
      { lock: true },
    );
  }
  async function worker<T>(
    work: ReachWork,
    operation: (tx: Transaction, row: Row) => Promise<T>,
  ) {
    return database.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.business_id',${work.business_id},true),set_config('app.actor_id','',true),set_config('app.reach_change',${work.id},true),set_config('app.reach_capability',${work.recovery_key},true)`,
      );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${work.business_id},0))`,
      );
      return operation(tx, await find(tx, work.business_id, work.id));
    });
  }
  const workFor = (row: Row): ReachWork => ({
    id: row.id,
    business_id: row.businessId,
    recovery_key: row.recoveryKey,
  });
  return {
    withdraw(
      actor: Actor,
      businessId: string,
      input: { changeId: string; requestKey: string },
      at: Date,
    ) {
      return authorized(actor, businessId, input.changeId, async (tx, row) => {
        if (!reachUnsent(await view(tx, row)))
          throw new ApplicationError("CONFLICT");
        await append(
          tx,
          row,
          `request:${input.requestKey}`,
          { kind: "withdrawn" },
          at,
          actor.userId,
        );
        return view(tx, row);
      });
    },
    workspace(actor: Actor, businessId: string, at: Date) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.read");
        const rows = await tx
          .select()
          .from(reachChange)
          .where(eq(reachChange.businessId, businessId))
          .orderBy(asc(reachChange.at));
        const changes = [];
        for (const row of rows) changes.push(await view(tx, row));
        const current = await tx.execute<{ id: string }>(
          sql`select id from public.current_paid_scope(${businessId}::uuid,${at.toISOString()}::timestamptz)`,
        );
        return {
          changes,
          currentPeriodId: current.rows[0]?.id ?? null,
          stopped: await stopped(tx, businessId),
        };
      });
    },
    queue(actor: Actor) {
      return scoped(database, actor, "", async (tx) => {
        const allowed = await tx.execute<{ allowed: boolean }>(
          sql`select exists(select 1 from public.platform_operator where user_id=${actor.userId} and reconciliation) as allowed`,
        );
        if (!allowed.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
        const changes = [];
        for (const row of await tx
          .select()
          .from(reachChange)
          .orderBy(asc(reachChange.at)))
          changes.push(await view(tx, row));
        return { changes };
      });
    },
    previewWork(actor: Actor, businessId: string, id: string) {
      return authorized(actor, businessId, id, async (_tx, row) =>
        workFor(row),
      );
    },
    approve(
      actor: Actor,
      businessId: string,
      input: {
        changeId: string;
        requestKey: string;
        accept: true;
        reviewHash: string;
      },
      at: Date,
      gateway: PaymentGateway,
      policy?: ReachPolicy,
    ) {
      return authorized(actor, businessId, input.changeId, async (tx, row) => {
        const change = await view(tx, row),
          key = `request:${input.requestKey}`;
        const previous = change.events.find((e) => e.key === key);
        if (previous) {
          if (
            previous.actorId !== actor.userId ||
            previous.fact.kind !== "approved" ||
            previous.fact.reviewHash !== input.reviewHash
          )
            throw new ApplicationError("CONFLICT");
          return change;
        }
        if (!change.reviewHash || change.reviewHash !== input.reviewHash)
          throw new ApplicationError("CONFLICT");
        if (change.state === "withdrawn")
          throw new ApplicationError("CONFLICT");
        if (change.events.some((e) => e.fact.kind === "approved"))
          throw new ApplicationError("CONFLICT");
        const expiry = await tx.execute<{ valid: boolean }>(
          sql`select ${row.expiresAt.toISOString()}::timestamptz>statement_timestamp() as valid`,
        );
        if (!expiry.rows[0]?.valid) throw new ApplicationError("CONFLICT");
        await current(tx, row, at, gateway, policy);
        const others = await tx
          .select()
          .from(reachChange)
          .where(eq(reachChange.businessId, businessId));
        for (const other of others)
          if (other.id !== row.id) {
            const otherChange = await view(tx, other);
            if (
              otherChange.events.some((e) => e.fact.kind === "approved") &&
              !otherChange.events.some(
                (e) => e.fact.kind === "applied" || e.fact.kind === "withdrawn",
              ) &&
              !(
                other.snapshot.path === "international_native" &&
                other.actionId === row.actionId &&
                other.snapshot.renewalAt <= row.snapshot.original.start
              )
            )
              throw new ApplicationError("CONFLICT");
          }
        const applied = others.filter(
          (c) => c.periodId === row.periodId && c.id !== row.id,
        );
        let latest: string | null = null,
          position = 0;
        for (const c of applied) {
          const events = await tx
            .select()
            .from(reachChangeEvent)
            .where(eq(reachChangeEvent.changeId, c.id));
          const p =
            events.filter((e) => e.fact.kind === "applied").at(-1)?.position ??
            0;
          if (p > position) {
            latest = c.id;
            position = p;
          }
        }
        if (latest !== row.snapshot.priorChangeId)
          throw new ApplicationError("CONFLICT");
        await append(
          tx,
          row,
          key,
          {
            kind: "approved",
            reviewHash: input.reviewHash,
            native: change.events.filter((e) => e.fact.native).at(-1)!.fact
              .native,
          },
          at,
          actor.userId,
        );
        return view(tx, row);
      });
    },
    authorize(
      actor: Actor,
      businessId: string,
      input: { changeId: string; requestKey: string },
      at: Date,
      action: "execute" | "refresh" | "checkout_mandate" | "checkout_delta",
      operator = false,
    ) {
      return authorized(
        actor,
        businessId,
        input.changeId,
        async (tx, row) => {
          const change = await view(tx, row);
          if (change.state === "withdrawn")
            throw new ApplicationError("CONFLICT");
          if (action === "execute" && reachUnsent(change)) {
            const valid = (
              await tx.execute<{ valid: boolean }>(
                sql`select ${row.expiresAt.toISOString()}::timestamptz>statement_timestamp() as valid`,
              )
            ).rows[0]?.valid;
            if (!valid) throw new ApplicationError("CONFLICT");
          }
          if (!change.events.some((e) => e.fact.kind === "approved"))
            throw new ApplicationError("CONFLICT");
          await append(
            tx,
            row,
            `request:${input.requestKey}`,
            { kind: "action", action },
            at,
            actor.userId,
          );
          return workFor(row);
        },
        operator,
      );
    },
    read(actor: Actor, businessId: string, id: string, operator = false) {
      return authorized(
        actor,
        businessId,
        id,
        (tx, row) => view(tx, row),
        operator,
      );
    },
    readWork(work: ReachWork) {
      return worker(work, (tx, row) => view(tx, row));
    },
    async pending(gateway: PaymentGateway) {
      return (
        await database.execute<ReachWork>(
          sql`select * from public.pending_reach_changes(${gateway.key},${gateway.account})`,
        )
      ).rows;
    },
    begin(
      actor: Actor,
      businessId: string,
      id: string,
      stage: ReachStage,
      at: Date,
      gateway: PaymentGateway,
      policy?: ReachPolicy,
      operator = false,
    ) {
      return authorized(
        actor,
        businessId,
        id,
        async (tx, row) => {
          await current(tx, row, at, gateway, policy);
          const change = await view(tx, row);
          if (change.state === "withdrawn")
            throw new ApplicationError("CONFLICT");
          if (!change.events.some((e) => e.fact.kind === "approved"))
            throw new ApplicationError("CONFLICT");
          const last = change.events
            .filter((e) => e.fact.stage === stage)
            .at(-1);
          if (last?.fact.kind === "attempt") return false;
          const attempts = change.events.filter(
            (e) => e.fact.stage === stage && e.fact.kind === "attempt",
          ).length;
          if (!gateway.reach) throw new ApplicationError("SETUP_REQUIRED");
          await append(
            tx,
            row,
            `attempt:${stage}:${attempts}`,
            {
              kind: "attempt",
              stage,
              body: z
                .record(z.string(), z.json())
                .parse(gateway.reach.intent(change, stage)),
            },
            at,
            actor.userId,
          );
          return true;
        },
        operator,
      );
    },
    finalGate(
      actor: Actor,
      businessId: string,
      id: string,
      at: Date,
      gateway: PaymentGateway,
      policy?: ReachPolicy,
      operator = false,
    ) {
      return authorized(
        actor,
        businessId,
        id,
        async (tx, row) => {
          await current(tx, row, at, gateway, policy);
          const events = (await view(tx, row)).events,
            native = events.filter((e) => e.fact.native).at(-1)?.fact.native;
          if (
            events.filter((e) => e.fact.kind === "attempt").length ===
              events.filter((e) => e.fact.kind === "preflight_stopped").length +
                1 &&
            !native?.oldStopped &&
            !native?.updated
          ) {
            const valid = (
              await tx.execute<{ valid: boolean }>(
                sql`select ${row.expiresAt.toISOString()}::timestamptz>statement_timestamp() as valid`,
              )
            ).rows[0]?.valid;
            if (!valid) throw new ApplicationError("CONFLICT");
          }
        },
        operator,
      );
    },
    preflightStopped(work: ReachWork, stage: ReachStage, at: Date) {
      return worker(work, async (tx, row) => {
        const change = await view(tx, row);
        const count = change.events.filter(
          (e) => e.fact.stage === stage && e.fact.kind === "attempt",
        ).length;
        await append(
          tx,
          row,
          `stopped:${stage}:${count}`,
          { kind: "preflight_stopped", stage },
          at,
        );
      });
    },
    observationIssue(work: ReachWork, reason: string, at: Date) {
      return worker(work, async (tx, row) => {
        const change = await view(tx, row);
        if (!change.events.some((e) => e.key === `review:${reason}`))
          await append(
            tx,
            row,
            `review:${reason}`,
            { kind: "review", reason },
            at,
          );
      });
    },
    checked(work: ReachWork, at: Date) {
      return worker(work, (tx, row) =>
        append(tx, row, `checked:${randomUUID()}`, { kind: "checked" }, at),
      );
    },
    observe(work: ReachWork, fact: ReachFact, at: Date) {
      return worker(work, async (tx, row) => {
        if (fact.native) {
          const previous = (await view(tx, row)).events
            .filter((e) => e.fact.native)
            .at(-1)?.fact.native;
          if (
            previous &&
            ((previous.subscriptionId &&
              fact.native.subscriptionId !== previous.subscriptionId) ||
              (previous.orderId && fact.native.orderId !== previous.orderId))
          )
            throw new ApplicationError("CONFLICT");
          const merged = {
            ...fact,
            native: {
              ...fact.native,
              oldStopped:
                fact.native.oldStopped || previous?.oldStopped === true,
            },
          };
          if (!isDeepStrictEqual(previous, merged.native))
            await append(tx, row, `native:${randomUUID()}`, merged, at);
        }
        if (fact.capture) {
          const approved = (await view(tx, row)).events;
          if (
            !approved.some((e) => e.fact.kind === "approved") ||
            !approved.some(
              (e) =>
                e.fact.kind === "attempt" &&
                e.fact.stage ===
                  (row.snapshot.path === "international_native"
                    ? "update"
                    : "order"),
            )
          )
            throw new ApplicationError("CONFLICT");
          const c = fact.capture,
            s = row.snapshot;
          if (
            c.provider !== s.delta.provider.key ||
            c.account !== s.delta.provider.account ||
            c.operationKey !== s.deltaOperationKey ||
            c.customerId !== s.original.charge?.customerId ||
            c.status !== "confirmed" ||
            c.amountMinor !== s.delta.tax.totals?.totalMinor ||
            c.currency !== s.delta.quote.currency ||
            !c.paymentId ||
            !c.paidAt ||
            c.periodStart !== s.effectiveAt ||
            c.periodEnd !== s.renewalAt ||
            !c.charge ||
            c.charge.kind !== "reach_delta" ||
            new Date(c.paidAt) > at
          )
            throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
          const previous = (await view(tx, row)).events.find(
            (e) => e.fact.kind === "capture",
          );
          if (previous && !isDeepStrictEqual(previous.fact.capture, c))
            throw new ApplicationError("CONFLICT");
          if (!previous) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`${c.provider}:${c.account}:${c.paymentId}`},0))`,
            );
            const taken = await tx.execute<{ allocated: boolean }>(
              sql`select public.subscription_payment_allocated(${c.provider},${c.account},${c.paymentId},${s.deltaActionId}::uuid) as allocated`,
            );
            if (taken.rows[0]?.allocated)
              throw new ApplicationError("CONFLICT");
            await tx.insert(subscriptionPayment).values({
              id: s.deltaActionId,
              businessId: row.businessId,
              requestKey: randomUUID(),
              operationKey: s.deltaOperationKey,
              recoveryKey: randomUUID(),
              quoteId: row.quoteId,
              snapshot: s.delta,
              actorId: row.actorId,
              at: row.at,
              state: "confirmed",
              started: true,
              observation: c,
            });
            const periodId = randomUUID();
            await tx.insert(subscriptionPeriod).values({
              id: periodId,
              businessId: row.businessId,
              actionId: s.deltaActionId,
              provider: c.provider,
              account: c.account,
              paymentId: c.paymentId,
              start: new Date(s.effectiveAt),
              end: new Date(s.renewalAt),
              snapshot: s.delta,
              charge: c,
            });
            await append(
              tx,
              row,
              "capture",
              { kind: "capture", capture: c, periodId },
              at,
            );
          }
        }
        return view(tx, row);
      });
    },
    prepareReplacement(work: ReachWork, at: Date) {
      return worker(work, async (tx, row) => {
        const s = row.snapshot,
          change = await view(tx, row),
          native = change.events.filter((e) => e.fact.native).at(-1)
            ?.fact.native;
        if (
          !native?.oldStopped ||
          s.path !== "replacement_mandate" ||
          at >= new Date(s.renewalAt)
        )
          throw new ApplicationError("CONFLICT");
        const [existing] = await tx
          .select()
          .from(subscriptionPayment)
          .where(eq(subscriptionPayment.id, s.replacementActionId));
        if (!existing)
          await tx.insert(subscriptionPayment).values({
            id: s.replacementActionId,
            businessId: row.businessId,
            requestKey: randomUUID(),
            operationKey: s.replacementOperationKey,
            recoveryKey: randomUUID(),
            quoteId: row.quoteId,
            snapshot: s.target,
            actorId: row.actorId,
            at,
            state: "pending",
            started: true,
            recovery: {
              creationAt: at.toISOString(),
              subscriptionSkip: 0,
              candidateId: null,
              ambiguous: false,
              invoiceSkip: 0,
            },
          });
      });
    },
    linkReplacement(work: ReachWork, at: Date) {
      return worker(work, async (tx, row) => {
        const s = row.snapshot,
          native = (await view(tx, row)).events
            .filter((e) => e.fact.native)
            .at(-1)?.fact.native;
        if (
          s.path !== "replacement_mandate" ||
          !native?.subscriptionId ||
          !native.checkoutUrl
        )
          return;
        await tx
          .update(subscriptionPayment)
          .set({
            checkout: {
              checkoutId: native.subscriptionId,
              subscriptionId: native.subscriptionId,
              planId: native.planId,
              customerId: native.customerId,
              url: native.checkoutUrl,
            },
            state: "checkout",
            reason: null,
            reconciledAt: at,
          })
          .where(eq(subscriptionPayment.id, s.replacementActionId));
      });
    },
    apply(
      work: ReachWork,
      at: Date,
      gateway: PaymentGateway,
      policy?: ReachPolicy,
    ) {
      return worker(work, async (tx, row) => {
        const change = await view(tx, row),
          s = row.snapshot,
          native = change.events.filter((e) => e.fact.native).at(-1)
            ?.fact.native;
        if (
          !change.events.some((e) => e.fact.kind === "approved") ||
          change.events.some(
            (e) => e.fact.kind === "applied" || e.fact.kind === "withdrawn",
          ) ||
          (native?.deltaRefundedMinor !== undefined &&
            native.deltaRefundedMinor !== "0") ||
          !native
        )
          return change;
        const periods = await tx
          .select()
          .from(subscriptionPeriod)
          .where(eq(subscriptionPeriod.businessId, row.businessId));
        const renewal = periods.find(
          (p) =>
            p.start <= at &&
            p.end > at &&
            (p.snapshot.reachRenewal?.changeId === row.id ||
              p.actionId === s.replacementActionId) &&
            p.start.toISOString() >= s.renewalAt &&
            p.snapshot.tax.totals?.totalMinor ===
              s.target.tax.totals?.totalMinor,
        );
        const immediate =
          s.direction === "expansion" &&
          change.events.some((e) => e.fact.kind === "capture") &&
          at < new Date(s.renewalAt);
        if (
          (!renewal && !immediate) ||
          (s.path === "international_native"
            ? !native.updated
            : !native.oldStopped || !native.mandateReady)
        )
          return change;
        try {
          await current(tx, row, at, gateway, policy, !!renewal);
        } catch {
          if (!change.events.some((e) => e.key === "activation_inputs_changed"))
            await append(
              tx,
              row,
              "activation_inputs_changed",
              { kind: "review", reason: "activation_inputs_changed" },
              at,
            );
          return view(tx, row);
        }
        await append(
          tx,
          row,
          "applied",
          { kind: "applied", ...(renewal ? { periodId: renewal.id } : {}) },
          at,
        );
        return view(tx, row);
      });
    },
    preview(
      actor: Actor,
      businessId: string,
      input: { periodId: string; quoteId: string; requestKey: string },
      at: Date,
      gateway: PaymentGateway,
      configuredPolicy?: ReachPolicy,
    ) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          await requireRunning(tx, businessId);
          const [previous] = await tx
            .select()
            .from(reachChange)
            .where(
              and(
                eq(reachChange.businessId, businessId),
                eq(reachChange.requestKey, input.requestKey),
              ),
            );
          if (previous) {
            if (
              previous.actorId !== actor.userId ||
              previous.periodId !== input.periodId ||
              previous.quoteId !== input.quoteId
            )
              throw new ApplicationError("CONFLICT");
            return view(tx, previous);
          }
          const policy = policyAt(configuredPolicy, gateway.mode, at);
          const config = await tx.execute<{ allowed: boolean }>(
            sql`select public.reach_configuration_matches(${JSON.stringify(policy)}::jsonb,${JSON.stringify(gateway.review ?? null)}::jsonb) as allowed`,
          );
          if (!config.rows[0]?.allowed) throw new ApplicationError("CONFLICT");
          const prior = await tx
            .select()
            .from(reachChange)
            .where(eq(reachChange.businessId, businessId));
          if (
            prior.some(
              (c) =>
                c.snapshot.policy.id === policy.id &&
                c.snapshot.policy.version === policy.version &&
                !isDeepStrictEqual(c.snapshot.policy, policy),
            )
          )
            throw new ApplicationError("CONFLICT");
          const [p] = await tx
            .select()
            .from(subscriptionPeriod)
            .where(
              and(
                eq(subscriptionPeriod.id, input.periodId),
                eq(subscriptionPeriod.businessId, businessId),
              ),
            );
          if (!p || p.start > at || p.end <= at || p.snapshot.adjustment)
            throw new ApplicationError("PAID_ACCESS_REQUIRED");
          const scope = await tx.execute<{ id: string }>(
            sql`select id from public.current_paid_scope(${businessId}::uuid,${at.toISOString()}::timestamptz)`,
          );
          if (scope.rows[0]?.id !== p.id)
            throw new ApplicationError("PAID_ACCESS_REQUIRED");
          const [a] = await tx
            .select()
            .from(subscriptionPayment)
            .where(eq(subscriptionPayment.id, p.actionId));
          if (
            !a ||
            a.state !== "confirmed" ||
            a.lifecycle?.cancellation ||
            a.lifecycle?.state === "cancelled" ||
            !p.charge?.charge ||
            p.charge.charge.method !== "card" ||
            !p.charge.customerId ||
            a.snapshot.term.kind !== "calendar_month" ||
            p.snapshot.provider.account !== gateway.account ||
            p.snapshot.provider.mode !== gateway.mode ||
            gateway.readiness?.().length
          )
            throw new ApplicationError("SETUP_REQUIRED");
          const quote = await targetQuote(tx, businessId, input.quoteId, at);
          if (quote.currency !== p.snapshot.quote.currency)
            throw new ApplicationError("INVALID_INPUT");
          let priorChange: Row | undefined,
            priorPosition = 0;
          for (const candidate of prior.filter((c) => c.periodId === p.id)) {
            const facts = await tx
              .select()
              .from(reachChangeEvent)
              .where(eq(reachChangeEvent.changeId, candidate.id));
            const pos = Math.max(
              0,
              ...facts
                .filter((e) => e.fact.kind === "applied")
                .map((e) => e.position),
            );
            if (pos > priorPosition) {
              priorChange = candidate;
              priorPosition = pos;
            }
          }
          if (priorChange?.snapshot.path === "replacement_mandate")
            throw new ApplicationError("SETUP_REQUIRED");
          const financial = priorChange?.snapshot.target ?? p.snapshot;
          const discovery = await paidAllowance(
              tx,
              businessId,
              "discovery",
              at,
            ),
            automation = await paidAllowance(tx, businessId, "automation", at);
          if (!discovery || !automation)
            throw new ApplicationError("PAID_ACCESS_REQUIRED");
          const old = {
            markets: financial.quote.pricing.offer.markets,
            discovery: financial.quote.renewal.discovery,
            automation: financial.quote.renewal.automation,
          };
          const next = {
            markets: quote.pricing.offer.markets,
            discovery: quote.renewal.discovery,
            automation: quote.renewal.automation,
          };
          if (
            old.discovery.unit !== next.discovery.unit ||
            old.automation.unit !== next.automation.unit
          )
            throw new ApplicationError("SETUP_REQUIRED");
          const expansion =
            old.markets.every((m) => next.markets.includes(m)) &&
            next.discovery.quantity >= old.discovery.quantity &&
            next.automation.quantity >= old.automation.quantity &&
            quote.renewal.subtotalMinor > financial.quote.renewal.subtotalMinor;
          const reduction =
            next.markets.every((m) => old.markets.includes(m)) &&
            next.discovery.quantity <= old.discovery.quantity &&
            next.automation.quantity <= old.automation.quantity &&
            quote.renewal.subtotalMinor < financial.quote.renewal.subtotalMinor;
          if (!expansion && !reduction)
            throw new ApplicationError("SETUP_REQUIRED");
          const fullTax = await appendTaxCalculation(
            tx,
            actor,
            businessId,
            {
              requestKey: randomUUID(),
              expectedProfileVersion: quote.profile.version,
              expectedReviewVersion: quote.billingReview.version,
              currency: quote.currency,
              lines: quote.renewal.lines.map((l) => ({
                id: l.kind,
                productCode: l.kind,
                description: l.label,
                quantity: 1,
                unitAmountMinor: String(l.amountMinor),
              })),
              note: "Reviewed reach renewal",
            },
            at,
            gateway.mode === "live" ? "live" : "fixture",
          );
          const target: PaymentSnapshot = {
            quote,
            tax: fullTax,
            term: { kind: "calendar_month", timeZone: "UTC" },
            provider: {
              key: gateway.key,
              account: gateway.account,
              mode: gateway.mode === "live" ? "live" : "test",
              review: gateway.review,
            },
          };
          if (
            fullTax.status !== "calculated" ||
            gateway.reviewSnapshot?.(target).length
          )
            throw new ApplicationError("SETUP_REQUIRED");
          const { numerator, denominator } = reachFraction(
            p.start.toISOString(),
            p.end.toISOString(),
            at,
            policy,
          );
          const deltaLines = expansion
            ? [
                ...new Set(
                  [
                    ...financial.quote.renewal.lines,
                    ...quote.renewal.lines,
                  ].map((l) => l.kind),
                ),
              ].map((kind) => {
                const before = financial.quote.renewal.lines.find(
                    (l) => l.kind === kind,
                  ),
                  after = quote.renewal.lines.find((l) => l.kind === kind),
                  difference =
                    BigInt(after?.amountMinor ?? 0) -
                    BigInt(before?.amountMinor ?? 0);
                if (difference < 0n)
                  throw new ApplicationError("SETUP_REQUIRED");
                return {
                  id: kind,
                  productCode: kind,
                  description: `${after?.label ?? kind} prorated expansion`,
                  quantity: 1,
                  unitAmountMinor: String(
                    round(difference, numerator, denominator),
                  ),
                };
              })
            : [
                {
                  id: "subscription",
                  productCode: "subscription",
                  description: "Renewal reduction; no immediate charge",
                  quantity: 1,
                  unitAmountMinor: "0",
                },
              ];
          const deltaNet = deltaLines.reduce(
            (sum, l) => sum + BigInt(l.unitAmountMinor),
            0n,
          );
          if (expansion && deltaNet <= 0n)
            throw new ApplicationError("SETUP_REQUIRED");
          const tax = await appendTaxCalculation(
            tx,
            actor,
            businessId,
            {
              requestKey: randomUUID(),
              expectedProfileVersion: quote.profile.version,
              expectedReviewVersion: quote.billingReview.version,
              currency: quote.currency,
              lines: deltaLines,
              note: "Frozen reach delta; no paid authority",
            },
            at,
            gateway.mode === "live" ? "live" : "fixture",
          );
          if (tax.status !== "calculated")
            throw new ApplicationError("SETUP_REQUIRED");
          const path =
            p.charge.charge.international &&
            gateway.review?.internationalUpdates ===
              "native_proration_reviewed" &&
            policy.nativeProration.enabled
              ? "international_native"
              : "replacement_mandate";
          if (path === "replacement_mandate" && !policy.replacement.enabled)
            throw new ApplicationError("SETUP_REQUIRED");
          const id = randomUUID();
          if (path === "replacement_mandate")
            target.replacement = {
              changeId: id,
              originalActionId: a.id,
              start: p.end.toISOString(),
              customerId: p.charge.customerId,
            };
          const delta: PaymentSnapshot = {
            ...target,
            tax,
            adjustment: {
              kind: "reach_delta",
              version: 1,
              changeId: id,
              originalPeriodId: p.id,
              start: at.toISOString(),
              end: p.end.toISOString(),
              pricing: {
                sourceQuoteId: financial.quote.id,
                targetQuoteId: quote.id,
                fromMonthlyNetMinor: String(
                  financial.quote.renewal.subtotalMinor,
                ),
                toMonthlyNetMinor: String(quote.renewal.subtotalMinor),
              },
              proration: {
                numerator: String(numerator),
                denominator: String(denominator),
                basis: policy.proration,
                rounding: policy.rounding,
                timeZone: "UTC",
              },
              policy: {
                id: policy.id,
                version: policy.version,
                reviewedBy: policy.reviewedBy,
                evidence: policy.evidence,
              },
              consumed: {
                discovery: discovery.allowance.quantity - discovery.remaining,
                automation:
                  automation.allowance.quantity - automation.remaining,
              },
              scope: {
                ...next,
                discovery: {
                  ...old.discovery,
                  quantity: expansion
                    ? discovery.allowance.quantity +
                      Number(
                        round(
                          BigInt(
                            next.discovery.quantity - old.discovery.quantity,
                          ),
                          numerator,
                          denominator,
                        ),
                      )
                    : next.discovery.quantity,
                },
                automation: {
                  ...old.automation,
                  quantity: expansion
                    ? automation.allowance.quantity +
                      Number(
                        round(
                          BigInt(
                            next.automation.quantity - old.automation.quantity,
                          ),
                          numerator,
                          denominator,
                        ),
                      )
                    : next.automation.quantity,
                },
              },
            },
          };
          const snapshot: ReachSnapshot = {
            currentFinancial: financial,
            priorChangeId: priorChange?.id ?? null,
            sourcePlanId: priorChange
              ? (await view(tx, priorChange)).events
                  .filter((e) => e.fact.native)
                  .at(-1)!.fact.native!.planId
              : p.charge.charge.planId,
            consumed: {
              discovery: discovery.allowance.quantity - discovery.remaining,
              automation: automation.allowance.quantity - automation.remaining,
            },
            version: 1,
            direction: expansion ? "expansion" : "reduction",
            path,
            original: paidPeriodSchema.parse({
              ...p,
              start: p.start.toISOString(),
              end: p.end.toISOString(),
            }),
            action: paymentActionSchema.parse({ ...a, at: a.at.toISOString() }),
            target,
            delta,
            policy,
            effectiveAt: at.toISOString(),
            renewalAt: p.end.toISOString(),
            proration: {
              numerator: String(numerator),
              denominator: String(denominator),
              rounding: policy.rounding,
              basis: policy.proration,
            },
            scope: delta.adjustment!.scope,
            renewalScope: next,
            deltaActionId: randomUUID(),
            replacementActionId: randomUUID(),
            deltaOperationKey: randomUUID(),
            replacementOperationKey: randomUUID(),
          };
          const [row] = await tx
            .insert(reachChange)
            .values({
              id,
              businessId,
              periodId: p.id,
              actionId: a.id,
              quoteId: quote.id,
              actorId: actor.userId,
              requestKey: input.requestKey,
              recoveryKey: randomUUID(),
              snapshot,
              at,
              expiresAt: sql`statement_timestamp() + ${policy.previewSeconds} * interval '1 second'`,
            })
            .returning();
          await bind(tx, row);
          await append(
            tx,
            row,
            `request:${input.requestKey}`,
            { kind: "preview" },
            at,
            actor.userId,
          );
          return view(tx, row);
        },
        { lock: true },
      );
    },
  };
}
