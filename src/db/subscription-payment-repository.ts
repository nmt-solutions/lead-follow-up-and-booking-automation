import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import {
  scoped,
  requireCapability,
  lockBusiness,
  type Transaction,
} from "./scope";
import { readBillingWorkspace } from "./billing-repository";
import { readPricingCatalog } from "./subscription-quote-repository";
import { appendTaxCalculation, readTaxCatalog } from "./tax-repository";
import { evaluateTax } from "../application/tax-calculation";
import {
  subscriptionQuote,
  subscriptionPayment,
  subscriptionPeriod,
  subscriptionPaymentEvent,
  subscriptionPaymentHistory,
  platformOperator,
} from "./schema";
import {
  subscriptionQuoteSchema,
  reviewSubscriptionQuote,
} from "../models/subscription-quotes";
import {
  paymentActionSchema,
  periodEnd,
  type PaymentGateway,
  type PaymentSnapshot,
  type PaymentWorkspace,
  type PaymentObservation,
  type AuthenticatedPaymentEvent,
  type PaymentAction,
} from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import { paidAllowance } from "./paid-access";

type Row = typeof subscriptionPayment.$inferSelect;
type Work = { id: string; business_id: string; recovery_key: string };
export function paymentView(row: Row) {
  return paymentActionSchema.parse({ ...row, at: row.at.toISOString() });
}
async function paymentAudit(tx: Transaction, row: Row) {
  const history = await tx
    .select()
    .from(subscriptionPaymentHistory)
    .where(eq(subscriptionPaymentHistory.actionId, row.id))
    .orderBy(
      asc(subscriptionPaymentHistory.at),
      asc(subscriptionPaymentHistory.id),
    );
  const events = await tx
    .select()
    .from(subscriptionPaymentEvent)
    .where(eq(subscriptionPaymentEvent.actionId, row.id))
    .orderBy(
      asc(subscriptionPaymentEvent.at),
      asc(subscriptionPaymentEvent.id),
    );
  return paymentActionSchema.parse({
    ...paymentView(row),
    history: history.map((h) => ({ ...h, at: h.at.toISOString() })),
    events: events.map((e) => ({ ...e, at: e.at.toISOString() })),
  });
}
export async function paymentAccess(
  tx: Transaction,
  businessId: string,
  at: Date,
) {
  const rows = await tx
    .select()
    .from(subscriptionPeriod)
    .where(eq(subscriptionPeriod.businessId, businessId))
    .orderBy(asc(subscriptionPeriod.end));
  const periods = rows.map((row) => ({
    ...row,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
  }));
  const period =
    periods.find(
      (row) => new Date(row.start) <= at && new Date(row.end) > at,
    ) ?? null;
  return {
    periods,
    access: {
      active: !!period,
      paidThrough: periods.at(-1)?.end ?? null,
      period,
    },
  };
}
async function trustedQuote(
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
        eq(subscriptionQuote.businessId, businessId),
        eq(subscriptionQuote.id, quoteId),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  const quote = subscriptionQuoteSchema.parse(row.snapshot);
  const review = reviewSubscriptionQuote(
    quote,
    await readBillingWorkspace(tx, businessId, at),
    (await readPricingCatalog(tx, at)).current,
  );
  if (!review.commercialReady)
    throw new ApplicationError("PRICING_SETUP_REQUIRED");
  return quote;
}
export function createSubscriptionPaymentRepository(database: Database) {
  async function worker<T>(
    work: Work,
    operation: (tx: Transaction, row: Row) => Promise<T>,
  ) {
    return database.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.actor_id','',true),set_config('app.business_id',${work.business_id},true),set_config('app.payment_action',${work.id},true),set_config('app.payment_capability',${work.recovery_key},true)`,
      );
      await lockBusiness(tx, work.business_id);
      const [row] = await tx
        .select()
        .from(subscriptionPayment)
        .where(
          and(
            eq(subscriptionPayment.id, work.id),
            eq(subscriptionPayment.businessId, work.business_id),
          ),
        );
      if (!row) throw new ApplicationError("NOT_FOUND");
      return operation(tx, row);
    });
  }
  const workFor = (row: Row): Work => ({
    id: row.id,
    business_id: row.businessId,
    recovery_key: row.recoveryKey,
  });
  async function requestAudit(
    tx: Transaction,
    row: Row,
    actor: Actor,
    kind: string,
    at: Date,
  ) {
    await tx.execute(
      sql`select set_config('app.payment_action',${row.id},true),set_config('app.payment_capability',${row.recoveryKey},true)`,
    );
    await tx.insert(subscriptionPaymentHistory).values({
      id: randomUUID(),
      businessId: row.businessId,
      actionId: row.id,
      actorId: actor.userId,
      kind,
      detail: {
        state: row.state,
        reason: row.reason,
        observation: row.observation,
      },
      at,
    });
  }
  async function record(
    tx: Transaction,
    row: Row,
    kind: string,
    state: PaymentAction["state"],
    reason: string | null,
    at: Date,
    observation: PaymentObservation | null = row.observation,
  ) {
    await tx.insert(subscriptionPaymentHistory).values({
      id: randomUUID(),
      businessId: row.businessId,
      actionId: row.id,
      kind,
      detail: { state, reason, observation },
      at,
    });
    const [updated] = await tx
      .update(subscriptionPayment)
      .set({ state, reason, observation, reconciledAt: at })
      .where(eq(subscriptionPayment.id, row.id))
      .returning();
    return paymentView(updated);
  }
  return {
    prepare(
      actor: Actor,
      businessId: string,
      input: { quoteId: string; requestKey: string },
      at: Date,
      gateway: PaymentGateway,
    ) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          const [previous] = await tx
            .select()
            .from(subscriptionPayment)
            .where(
              and(
                eq(subscriptionPayment.businessId, businessId),
                eq(subscriptionPayment.requestKey, input.requestKey),
              ),
            );
          if (previous) {
            if (previous.quoteId !== input.quoteId)
              throw new ApplicationError("CONFLICT");
            return paymentView(previous);
          }
          const quote = await trustedQuote(tx, businessId, input.quoteId, at);
          if (
            gateway.mode === "unconfigured" ||
            !gateway.supports(quote.currency)
          )
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
              lines: quote.initial.lines.map((line) => ({
                id: line.kind,
                productCode: line.kind,
                description: line.label,
                quantity: 1,
                unitAmountMinor: String(line.amountMinor),
              })),
              note: `Checkout quote ${quote.id}`,
            },
            at,
            gateway.mode,
          );
          const snapshot: PaymentSnapshot = {
            quote,
            tax,
            provider: {
              key: gateway.key,
              account: gateway.account,
              mode: gateway.mode,
            },
            term:
              quote.initial.kind === "paid_pilot"
                ? { kind: "days", days: quote.initial.days!, timeZone: "UTC" }
                : { kind: "calendar_month", timeZone: "UTC" },
          };
          const reason =
            tax.status !== "calculated"
              ? "tax_review_required"
              : quote.initial.automation.quantity > 0 &&
                  quote.initial.automation.unit !== "provider calls"
                ? "allowance_units_unavailable"
                : null;
          const [row] = await tx
            .insert(subscriptionPayment)
            .values({
              id: randomUUID(),
              businessId,
              requestKey: input.requestKey,
              operationKey: randomUUID(),
              recoveryKey: randomUUID(),
              quoteId: quote.id,
              snapshot,
              actorId: actor.userId,
              at,
              state: reason ? "review_required" : "reviewed",
              reason,
            })
            .returning();
          return paymentView(row);
        },
        { lock: true },
      );
    },
    workspace(
      actor: Actor,
      businessId: string,
      at: Date,
      gateway: PaymentGateway,
    ): Promise<PaymentWorkspace> {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "billing.read");
        const rows = await tx
          .select()
          .from(subscriptionPayment)
          .where(eq(subscriptionPayment.businessId, businessId))
          .orderBy(asc(subscriptionPayment.at), asc(subscriptionPayment.id));
        const discovery = await paidAllowance(tx, businessId, "discovery", at),
          automation = await paidAllowance(tx, businessId, "automation", at);
        const allowance = (item: NonNullable<typeof discovery>) => ({
          unit: item.allowance.unit,
          included: item.allowance.quantity,
          reserved: item.allowance.quantity - item.remaining,
          remaining: item.remaining,
        });
        return {
          actions: await Promise.all(rows.map((row) => paymentAudit(tx, row))),
          ...(await paymentAccess(tx, businessId, at)),
          allowances:
            discovery && automation
              ? {
                  discovery: allowance(discovery),
                  automation: allowance(automation),
                }
              : null,
          gateway: {
            key: gateway.key,
            mode: gateway.mode,
            ready: gateway.mode !== "unconfigured",
          },
        };
      });
    },
    begin(
      actor: Actor,
      businessId: string,
      actionId: string,
      at: Date,
      gateway: PaymentGateway,
    ) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          const [row] = await tx
            .select()
            .from(subscriptionPayment)
            .where(
              and(
                eq(subscriptionPayment.businessId, businessId),
                eq(subscriptionPayment.id, actionId),
              ),
            );
          if (!row) throw new ApplicationError("NOT_FOUND");
          if (row.started || row.state !== "reviewed")
            return { action: paymentView(row), work: null };
          const binding = row.snapshot.provider;
          if (
            binding.key !== gateway.key ||
            binding.account !== gateway.account ||
            binding.mode !== gateway.mode ||
            !gateway.supports(row.snapshot.quote.currency)
          )
            throw new ApplicationError("SETUP_REQUIRED");
          let current = true;
          try {
            await trustedQuote(tx, businessId, row.quoteId, at);
          } catch (error: unknown) {
            if (
              !(error instanceof ApplicationError) ||
              error.code !== "PRICING_SETUP_REQUIRED"
            )
              throw error;
            current = false;
          }
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0)),set_config('app.tax_calculation','true',true)`,
          );
          const tax = evaluateTax(
            row.snapshot.tax.input,
            await readBillingWorkspace(tx, businessId, at),
            await readTaxCatalog(tx),
            at,
            binding.mode,
          );
          if (
            !current ||
            (row.snapshot.quote.initial.automation.quantity > 0 &&
              row.snapshot.quote.initial.automation.unit !==
                "provider calls") ||
            tax.status !== "calculated" ||
            !isDeepStrictEqual(tax.lines, row.snapshot.tax.lines) ||
            !isDeepStrictEqual(tax.totals, row.snapshot.tax.totals)
          ) {
            const [updated] = await tx
              .update(subscriptionPayment)
              .set({
                state: "review_required",
                reason: "financial_inputs_changed",
              })
              .where(eq(subscriptionPayment.id, row.id))
              .returning();
            return { action: paymentView(updated), work: null };
          }
          const all = await tx
            .select()
            .from(subscriptionPayment)
            .where(eq(subscriptionPayment.businessId, businessId));
          const access = await paymentAccess(tx, businessId, at);
          if (
            access.periods.some((p) => new Date(p.end) > at) ||
            all.some(
              (a) =>
                a.id !== row.id &&
                a.started &&
                (a.state !== "failed" || a.reconciliationPending) &&
                a.state !== "confirmed",
            )
          )
            throw new ApplicationError("CONFLICT");
          const [updated] = await tx
            .update(subscriptionPayment)
            .set({
              started: true,
              state: "pending",
              reason: "creation_pending",
            })
            .where(eq(subscriptionPayment.id, row.id))
            .returning();
          await requestAudit(tx, updated, actor, "checkout_started", at);
          return { action: paymentView(updated), work: workFor(updated) };
        },
        { lock: true },
      );
    },
    async creation(work: Work, checkout: Row["checkout"], at: Date) {
      return worker(work, async (tx, row) => {
        if (row.state === "confirmed") return paymentView(row);
        if (
          row.checkout &&
          checkout &&
          (row.checkout.checkoutId !== checkout.checkoutId ||
            row.checkout.customerId !== checkout.customerId ||
            row.checkout.subscriptionId !== checkout.subscriptionId)
        )
          return record(
            tx,
            row,
            "checkout_mismatch",
            "review_required",
            "provider_binding_mismatch",
            at,
          );
        if (checkout)
          await tx
            .update(subscriptionPayment)
            .set({ checkout })
            .where(eq(subscriptionPayment.id, row.id));
        return record(
          tx,
          { ...row, checkout: checkout ?? row.checkout },
          "checkout_creation",
          row.observation ? row.state : checkout ? "checkout" : "pending",
          row.observation
            ? row.reason
            : checkout
              ? null
              : "creation_outcome_unknown",
          at,
        );
      });
    },
    async pending(gateway: PaymentGateway) {
      const result = await database.execute<Work>(
        sql`select * from public.pending_subscription_payments(${gateway.key},${gateway.account})`,
      );
      return result.rows;
    },
    readWork(work: Work) {
      return worker(work, async (_tx, row) => paymentView(row));
    },
    async receive(event: AuthenticatedPaymentEvent, at: Date) {
      const o = event.observation;
      const target = await database.execute<Work>(
        sql`select * from public.subscription_payment_target(${o.provider},${o.account},${o.operationKey}::uuid)`,
      );
      const work = target.rows[0];
      if (!work) {
        await database.transaction(async (tx) => {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${o.provider}:${o.account}:${event.eventId}`},0))`,
          );
          const identity = await tx.execute<{ state: string }>(
            sql`select public.payment_event_identity(${o.provider},${o.account},${event.eventId},${event.payloadHash},null::uuid) as state`,
          );
          if (identity.rows[0]?.state === "conflict")
            throw new ApplicationError("CONFLICT");
          if (identity.rows[0]?.state === "new")
            await tx.execute(
              sql`select public.capture_unmatched_payment_event(${JSON.stringify(event)}::jsonb,${at.toISOString()}::timestamptz)`,
            );
        });
        return null;
      }
      await worker(work, async (tx, row) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${o.provider}:${o.account}:${event.eventId}`},0))`,
        );
        const identity = await tx.execute<{ state: string }>(
          sql`select public.payment_event_identity(${o.provider},${o.account},${event.eventId},${event.payloadHash},${row.id}::uuid) as state`,
        );
        if (identity.rows[0]?.state === "conflict")
          throw new ApplicationError("CONFLICT");
        const [previous] = await tx
          .select()
          .from(subscriptionPaymentEvent)
          .where(
            and(
              eq(subscriptionPaymentEvent.provider, o.provider),
              eq(subscriptionPaymentEvent.account, o.account),
              eq(subscriptionPaymentEvent.eventId, event.eventId),
            ),
          );
        if (previous) {
          if (
            previous.payloadHash !== event.payloadHash ||
            previous.actionId !== row.id ||
            !isDeepStrictEqual(previous.observation, o)
          )
            throw new ApplicationError("CONFLICT");
          if (row.state !== "confirmed")
            await tx
              .update(subscriptionPayment)
              .set({ reconciliationPending: true })
              .where(eq(subscriptionPayment.id, row.id));
          return;
        }
        await tx.insert(subscriptionPaymentEvent).values({
          id: randomUUID(),
          businessId: row.businessId,
          actionId: row.id,
          provider: o.provider,
          account: o.account,
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          observation: o,
          at,
        });
        if (row.state !== "confirmed")
          await tx
            .update(subscriptionPayment)
            .set({ reconciliationPending: true })
            .where(eq(subscriptionPayment.id, row.id));
      });
      return work;
    },
    async reconcile(
      work: Work,
      observation: PaymentObservation | null,
      at: Date,
    ) {
      return worker(work, async (tx, row) => {
        if (row.state === "confirmed") return paymentView(row);
        if (!observation)
          return record(
            tx,
            row,
            "reconciliation_unavailable",
            "pending",
            "reconciliation_unavailable",
            at,
          );
        await tx
          .update(subscriptionPayment)
          .set({ reconciliationPending: false })
          .where(eq(subscriptionPayment.id, row.id));
        const o = observation,
          s = row.snapshot;
        if (
          o.provider !== s.provider.key ||
          o.account !== s.provider.account ||
          o.operationKey !== row.operationKey ||
          (o.checkout &&
            (o.checkout.checkoutId !== o.checkoutId ||
              o.checkout.customerId !== o.customerId ||
              o.checkout.subscriptionId !== o.subscriptionId)) ||
          (row.checkout &&
            (o.checkoutId !== row.checkout.checkoutId ||
              o.customerId !== row.checkout.customerId ||
              o.subscriptionId !== row.checkout.subscriptionId)) ||
          (o.currency !== null && o.currency !== s.quote.currency) ||
          (o.amountMinor !== null && o.amountMinor !== s.tax.totals?.totalMinor)
        )
          return record(
            tx,
            row,
            "reconciliation_mismatch",
            "review_required",
            "provider_binding_mismatch",
            at,
            o,
          );
        if (!row.checkout && o.checkout)
          await tx
            .update(subscriptionPayment)
            .set({ checkout: o.checkout })
            .where(eq(subscriptionPayment.id, row.id));
        if (o.status !== "confirmed") {
          const confirmationReceipts =
            o.status === "failed"
              ? await tx
                  .select()
                  .from(subscriptionPaymentEvent)
                  .where(eq(subscriptionPaymentEvent.actionId, row.id))
              : [];
          if (
            confirmationReceipts.some(
              (receipt) => receipt.observation.status === "confirmed",
            )
          )
            return record(
              tx,
              row,
              "reconciliation_conflict",
              "review_required",
              "provider_event_conflict",
              at,
              o,
            );
          const state =
            o.status === "failed"
              ? "failed"
              : o.status === "pending" && (row.checkout || o.checkout)
                ? "checkout"
                : "pending";
          if (isDeepStrictEqual(o, row.observation) && row.state === state) {
            await tx
              .update(subscriptionPayment)
              .set({ reconciledAt: at })
              .where(eq(subscriptionPayment.id, row.id));
            return paymentView(row);
          }
          return record(
            tx,
            row,
            "reconciliation",
            state,
            o.status === "unknown" ? "provider_outcome_unknown" : null,
            at,
            o,
          );
        }
        if (
          !o.checkoutId ||
          !o.customerId ||
          !o.paymentId ||
          o.currency !== s.quote.currency ||
          o.amountMinor !== s.tax.totals?.totalMinor ||
          !o.paidAt ||
          !o.periodStart ||
          !o.periodEnd ||
          new Date(o.periodStart) < row.at ||
          new Date(o.periodStart) > new Date(o.paidAt) ||
          new Date(o.periodEnd) <= new Date(o.paidAt) ||
          new Date(o.paidAt) > at ||
          new Date(periodEnd(o.periodStart, s.term)).getTime() !==
            new Date(o.periodEnd).getTime()
        )
          return record(
            tx,
            row,
            "reconciliation_mismatch",
            "review_required",
            "payment_or_period_mismatch",
            at,
            o,
          );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`${o.provider}:${o.account}:${o.paymentId}`},0))`,
        );
        const allocated = await tx.execute<{ allocated: boolean }>(
          sql`select public.subscription_payment_allocated(${o.provider},${o.account},${o.paymentId},${row.id}::uuid) as allocated`,
        );
        const existing = await tx
          .select()
          .from(subscriptionPeriod)
          .where(eq(subscriptionPeriod.businessId, row.businessId));
        if (
          allocated.rows[0]?.allocated ||
          existing.some(
            (p) =>
              p.start < new Date(o.periodEnd!) &&
              p.end > new Date(o.periodStart!),
          )
        )
          return record(
            tx,
            row,
            "reconciliation_mismatch",
            "review_required",
            "payment_or_period_already_allocated",
            at,
            o,
          );
        await tx.insert(subscriptionPeriod).values({
          id: randomUUID(),
          actionId: row.id,
          businessId: row.businessId,
          provider: o.provider,
          account: o.account,
          paymentId: o.paymentId,
          start: new Date(o.periodStart),
          end: new Date(o.periodEnd),
          snapshot: s,
        });
        return record(tx, row, "payment_confirmed", "confirmed", null, at, o);
      });
    },
    async operatorQueue(actor: Actor) {
      return scoped(database, actor, "", async (tx) => {
        const [operator] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (!operator?.reconciliation) throw new ApplicationError("FORBIDDEN");
        return Promise.all(
          (
            await tx
              .select()
              .from(subscriptionPayment)
              .orderBy(asc(subscriptionPayment.at))
          ).map((row) => paymentAudit(tx, row)),
        );
      });
    },
    async unmatchedEvents(actor: Actor) {
      return scoped(database, actor, "", async (tx) => {
        const [operator] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (!operator?.reconciliation) throw new ApplicationError("FORBIDDEN");
        const rows = await tx
          .select()
          .from(subscriptionPaymentEvent)
          .where(sql`${subscriptionPaymentEvent.actionId} is null`)
          .orderBy(asc(subscriptionPaymentEvent.at));
        return rows.map((row) => ({ ...row, at: row.at.toISOString() }));
      });
    },
    async authorizeWork(
      actor: Actor,
      businessId: string,
      actionId: string,
      at: Date,
      operator = false,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        if (operator) {
          const [grant] = await tx
            .select()
            .from(platformOperator)
            .where(eq(platformOperator.userId, actor.userId));
          if (!grant?.reconciliation) throw new ApplicationError("FORBIDDEN");
        } else await requireCapability(tx, actor, businessId, "billing.manage");
        const [row] = await tx
          .select()
          .from(subscriptionPayment)
          .where(
            and(
              eq(subscriptionPayment.id, actionId),
              eq(subscriptionPayment.businessId, businessId),
            ),
          );
        if (!row || !row.started) throw new ApplicationError("NOT_FOUND");
        await requestAudit(tx, row, actor, "reconciliation_requested", at);
        return workFor(row);
      });
    },
  };
}
