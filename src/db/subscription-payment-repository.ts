import { randomUUID, createHash } from "node:crypto";
import {
  reconcileLifecycle,
  appendLifecycleEvent,
} from "./subscription-lifecycle";
import {
  effectiveLifecyclePolicy,
  lifecycleEventSchema,
  type LifecycleObservation,
  type LifecyclePolicy,
} from "../models/subscription-lifecycle";
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
  subscriptionLifecycleEvent,
  platformOperator,
} from "./schema";
import {
  subscriptionQuoteSchema,
  reviewSubscriptionQuote,
} from "../models/subscription-quotes";
import {
  paymentActionSchema,
  mandateProofSchema,
  type MandateProof,
  periodEnd,
  monthlyPeriodMatches,
  type PaymentGateway,
  type PaymentSnapshot,
  type PaymentWorkspace,
  type PaymentObservation,
  type AuthenticatedPaymentEvent,
  type PaymentAction,
} from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import { paidAllowance, readPaidContract } from "./paid-access";
import { z } from "zod";
import {
  billingState,
  billingRevisionSchema,
  billingReviewSchema,
} from "../models/billing";
import { taxCatalogSchema } from "../models/tax";
import { chargeTaxSchema } from "../models/subscription-payments";
import {
  hasMfa,
  operatorMfaLifetime,
  businessMfaLifetime,
} from "../auth/access";
import { session } from "./schema";

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
  const lifecycleEvents = await tx
    .select()
    .from(subscriptionLifecycleEvent)
    .where(eq(subscriptionLifecycleEvent.actionId, row.id))
    .orderBy(
      asc(subscriptionLifecycleEvent.at),
      asc(subscriptionLifecycleEvent.id),
    );
  return paymentActionSchema.parse({
    ...paymentView(row),
    lifecycleEvents: lifecycleEvents.map((e) =>
      lifecycleEventSchema.parse({ ...e, at: e.at.toISOString() }),
    ),
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
  const scope = await tx.execute<{ id: string }>(
    sql`select id from public.current_paid_scope(${businessId}::uuid,${at.toISOString()}::timestamptz)`,
  );
  const period = periods.find((row) => row.id === scope.rows[0]?.id) ?? null;
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
async function assurePaymentActor(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  operator: boolean,
) {
  if (!("sessionId" in actor) || typeof actor.sessionId !== "string")
    throw new ApplicationError("UNAUTHENTICATED");
  const [s] = await tx
    .select()
    .from(session)
    .where(eq(session.id, actor.sessionId));
  const now = new Date();
  if (!s || s.userId !== actor.userId || s.expiresAt <= now)
    throw new ApplicationError("UNAUTHENTICATED");
  if (
    !(await hasMfa(
      tx,
      s.token,
      now,
      operator ? operatorMfaLifetime : businessMfaLifetime,
    ))
  )
    throw new ApplicationError("MFA_REQUIRED");
  if (operator) {
    const [grant] = await tx
      .select()
      .from(platformOperator)
      .where(eq(platformOperator.userId, actor.userId));
    if (!grant?.reconciliation) throw new ApplicationError("FORBIDDEN");
  } else await requireCapability(tx, actor, businessId, "billing.manage");
  const trusted = await tx.execute<{ valid: boolean }>(
    sql`select exists(select 1 from public.session where id=${actor.sessionId} and user_id=${actor.userId} and expires_at>clock_timestamp()) valid`,
  );
  if (!trusted.rows[0]?.valid) throw new ApplicationError("UNAUTHENTICATED");
  if (s.expiresAt <= new Date()) throw new ApplicationError("UNAUTHENTICATED");
  if (
    !s.mfaVerifiedAt ||
    new Date().getTime() - s.mfaVerifiedAt.getTime() >=
      (operator ? operatorMfaLifetime : businessMfaLifetime)
  )
    throw new ApplicationError("MFA_REQUIRED");
}

export function createSubscriptionPaymentRepository(database: Database) {
  async function renewalSnapshot(
    tx: Transaction,
    row: Row,
    o: PaymentObservation,
    at: Date,
  ): Promise<PaymentSnapshot> {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0))`,
    );
    const context = await tx.execute<{ context: unknown }>(
      sql`select public.payment_renewal_context(${row.id}::uuid,${row.businessId}::uuid) as context`,
    );
    const raw = z
      .object({
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
      })
      .parse(context.rows[0]?.context);
    const camel = (r: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_s, l: string) => l.toUpperCase()),
          k === "at" && typeof v === "string" ? new Date(v).toISOString() : v,
        ]),
      );
    const billing = billingState(
      raw.history.map((r) => billingRevisionSchema.parse(camel(r))),
      raw.reviews.map((r) => billingReviewSchema.parse(camel(r))),
    );
    for (const evidence of billing.current?.evidence ?? []) {
      const file = raw.files.find((f) => f.id === evidence.fileId);
      if (
        !file ||
        file.state !== "ready" ||
        file.sha256 !== evidence.sha256 ||
        new Date(file.retentionUntil) <= at
      ) {
        billing.status = "missing";
        billing.issues.push("evidence_unavailable");
      }
    }
    const configuration = taxCatalogSchema.parse({
      revisions: raw.revisions.map(camel),
      decisions: raw.decisions.map(camel),
    });
    const contracts =
      paymentActionSchema.shape.reachRenewals.parse(
        (
          await tx.execute<{ contracts: unknown }>(
            sql`select public.payment_reach_contract(${row.id}::uuid,${row.businessId}::uuid) as contracts`,
          )
        ).rows[0]?.contracts,
      ) ?? [];
    const changed = contracts
      .filter(
        (c) =>
          c.native.updated &&
          c.native.planId === o.charge?.planId &&
          c.renewalAt <= (o.periodStart ?? ""),
      )
      .at(-1);
    const s = changed?.target ?? row.snapshot,
      q = s.quote;
    const input = {
      requestKey: randomUUID(),
      expectedProfileVersion: billing.version,
      expectedReviewVersion: billing.reviewVersion,
      currency: q.currency,
      lines: q.renewal.lines.map((l) => ({
        id: l.kind,
        productCode: l.kind,
        description: l.label,
        quantity: 1,
        unitAmountMinor: String(l.amountMinor),
      })),
      note: `Subscription charge ${o.paymentId}`,
    };
    const mode = s.provider.mode === "live" ? "live" : "fixture";
    const tax = chargeTaxSchema.parse({
      id: randomUUID(),
      businessId: row.businessId,
      actionId: row.id,
      purpose: "subscription_charge",
      mode,
      currency: q.currency,
      minorUnit: 2,
      input,
      billing,
      configuration,
      ...evaluateTax(input, billing, configuration, new Date(o.paidAt!), mode),
      at: at.toISOString(),
    });
    return {
      ...s,
      ...(changed ? { reachRenewal: { changeId: changed.changeId } } : {}),
      tax,
      term: { kind: "calendar_month", timeZone: "UTC" },
      basis: {
        kind: "renewal",
        discovery: q.renewal.discovery,
        automation: q.renewal.automation,
      },
    };
  }
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
  async function authorizedAction<T>(
    actor: Actor,
    businessId: string,
    actionId: string,
    operator: boolean,
    operation: (tx: Transaction, row: Row) => Promise<T>,
  ) {
    return scoped(database, actor, businessId, async (tx) => {
      await lockBusiness(tx, businessId);
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
      if (!row.snapshot.upi) return operation(tx, row);
      await assurePaymentActor(tx, actor, businessId, operator);
      const result = await operation(tx, row);
      await assurePaymentActor(tx, actor, businessId, operator);
      return result;
    });
  }
  return {
    checkoutProofIntent(
      actor: Actor,
      businessId: string,
      input: MandateProof & { payloadHash: string },
      at: Date,
    ) {
      return authorizedAction(
        actor,
        businessId,
        input.actionId,
        false,
        async (tx, row) => {
          if (!row.snapshot.upi || !row.snapshot.replacement)
            throw new ApplicationError("SETUP_REQUIRED");
          const [previous] = await tx
            .select()
            .from(subscriptionPaymentHistory)
            .where(eq(subscriptionPaymentHistory.id, input.requestKey));
          const kind = `checkout_proof:${input.payloadHash}`;
          if (previous) {
            if (
              previous.actionId !== row.id ||
              previous.actorId !== actor.userId ||
              previous.kind !== kind
            )
              throw new ApplicationError("CONFLICT");
            return workFor(row);
          }
          await tx.execute(
            sql`select set_config('app.payment_action',${row.id},true),set_config('app.payment_capability',${row.recoveryKey},true)`,
          );
          await tx.insert(subscriptionPaymentHistory).values({
            id: input.requestKey,
            businessId,
            actionId: row.id,
            actorId: actor.userId,
            kind,
            at,
            detail: {
              state: row.state,
              reason: row.reason,
              observation: row.observation,
              checkoutProof: mandateProofSchema.strip().parse(input),
            },
          });
          return workFor(row);
        },
      );
    },
    checkoutProofs(work: Work) {
      return worker(work, async (tx, row) => {
        if (!row.snapshot.upi) return [];
        const rows = await tx
          .select()
          .from(subscriptionPaymentHistory)
          .where(
            and(
              eq(subscriptionPaymentHistory.actionId, row.id),
              sql`${subscriptionPaymentHistory.kind} like 'checkout_proof:%'`,
              sql`not exists(select 1 from public.subscription_payment_event e where e.action_id=${row.id} and e.event_id='checkout:'||${row.id}::text||':'||(${subscriptionPaymentHistory.detail}->'checkoutProof'->>'paymentId'))`,
            ),
          )
          .orderBy(
            asc(subscriptionPaymentHistory.at),
            asc(subscriptionPaymentHistory.id),
          )
          .limit(100);
        return rows.flatMap((r) => {
          const proof = mandateProofSchema.safeParse(r.detail.checkoutProof);
          if (
            !proof.success ||
            proof.data.actionId !== row.id ||
            proof.data.requestKey !== r.id ||
            r.kind !==
              `checkout_proof:${createHash("sha256").update(JSON.stringify(proof.data)).digest("hex")}`
          )
            return [];
          return [proof.data];
        });
      });
    },
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
            gateway.mode === "test" ? "fixture" : gateway.mode,
          );
          const snapshot: PaymentSnapshot = {
            quote,
            tax,
            provider: {
              key: gateway.key,
              account: gateway.account,
              mode: gateway.mode,
              ...(gateway.review ? { review: gateway.review } : {}),
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
                : (gateway.reviewSnapshot?.(snapshot)[0] ?? null);
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
        await lockBusiness(tx, businessId);
        await requireCapability(tx, actor, businessId, "billing.read");
        const rows = await tx
          .select()
          .from(subscriptionPayment)
          .where(eq(subscriptionPayment.businessId, businessId))
          .orderBy(asc(subscriptionPayment.at), asc(subscriptionPayment.id));
        for (const row of rows) {
          if (row.snapshot.adjustment) continue;
          await tx.execute(
            sql`select set_config('app.payment_action',${row.id},true),set_config('app.payment_capability',${row.recoveryKey},true)`,
          );
          row.lifecycle = await reconcileLifecycle(
            tx,
            row,
            at,
            gateway.lifecyclePolicy,
          );
        }
        const discovery = await paidAllowance(tx, businessId, "discovery", at),
          automation = await paidAllowance(tx, businessId, "automation", at);
        const allowance = (item: NonNullable<typeof discovery>) => ({
          unit: item.allowance.unit,
          included: item.allowance.quantity,
          reserved: item.allowance.quantity - item.remaining,
          remaining: item.remaining,
        });
        const result = {
          actions: await (async () => {
            const result: PaymentAction[] = [];
            for (const row of rows) result.push(await paymentAudit(tx, row));
            return result;
          })(),
          effectiveScope:
            discovery && automation
              ? {
                  periodId: discovery.period.id,
                  markets: discovery.period.markets,
                  discovery: discovery.allowance,
                  automation: automation.allowance,
                }
              : null,
          effectiveContract: await readPaidContract(tx, businessId, at),
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
            ready:
              gateway.mode !== "unconfigured" && !gateway.readiness?.().length,
            reasons: gateway.readiness?.(),
            review: gateway.review,
          },
        };
        await requireCapability(tx, actor, businessId, "billing.read");
        if (rows.some((r) => r.snapshot.upi))
          await assurePaymentActor(tx, actor, businessId, false);
        return result;
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
          if (gateway.reviewSnapshot?.(row.snapshot).length)
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
            binding.mode === "test" ? "fixture" : binding.mode,
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
              recovery: {
                creationAt: at.toISOString(),
                subscriptionSkip: 0,
                candidateId: null,
                ambiguous: false,
                invoiceSkip: 0,
              },
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
        if (row.state === "confirmed" && !checkout) return paymentView(row);
        if (
          row.checkout &&
          checkout &&
          (row.checkout.checkoutId !== checkout.checkoutId ||
            (row.checkout.customerId !== null &&
              row.checkout.customerId !== checkout.customerId) ||
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
    creationRejected(work: Work, at: Date) {
      return worker(work, async (tx, row) =>
        row.state === "confirmed"
          ? paymentView(row)
          : record(
              tx,
              row,
              "creation_not_attempted",
              "failed",
              "native_preflight_rejected",
              at,
            ),
      );
    },
    async pending(gateway: PaymentGateway) {
      const result = await database.execute<Work>(
        sql`select * from public.pending_subscription_payments(${gateway.key},${gateway.account})`,
      );
      return result.rows;
    },
    saveRecovery(work: Work, recovery: PaymentAction["recovery"], at: Date) {
      return worker(work, async (tx, row) => {
        await tx
          .update(subscriptionPayment)
          .set({
            recovery,
            reconciledAt: at,
            reconciliationPending: false,
            ...(recovery?.ambiguous
              ? {
                  state: "review_required" as const,
                  reason: "creation_lookup_ambiguous",
                }
              : {}),
          })
          .where(eq(subscriptionPayment.id, row.id));
      });
    },
    lifecycle(
      work: Work,
      at: Date,
      policy?: LifecyclePolicy,
      observation?: LifecycleObservation,
    ) {
      return worker(work, async (tx, row) =>
        reconcileLifecycle(tx, row, at, policy, observation),
      );
    },
    beginCancellation(
      actor: Actor,
      businessId: string,
      actionId: string,
      requestKey: string,
      at: Date,
      gateway: PaymentGateway,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await lockBusiness(tx, businessId);
        await requireCapability(tx, actor, businessId, "billing.manage");
        const [row] = await tx
          .select()
          .from(subscriptionPayment)
          .where(
            and(
              eq(subscriptionPayment.id, actionId),
              eq(subscriptionPayment.businessId, businessId),
            ),
          );
        if (!row?.started || !row.checkout?.subscriptionId)
          throw new ApplicationError("NOT_FOUND");
        if (row.snapshot.upi) {
          await assurePaymentActor(tx, actor, businessId, false);
          at = new Date();
        }
        const policy = effectiveLifecyclePolicy(
          gateway.lifecyclePolicy,
          row.snapshot.provider.mode,
          at,
        );
        if (
          !policy ||
          !gateway.cancel ||
          gateway.key !== row.snapshot.provider.key ||
          gateway.account !== row.snapshot.provider.account ||
          gateway.mode !== row.snapshot.provider.mode
        )
          throw new ApplicationError("SETUP_REQUIRED");
        await tx.execute(
          sql`select set_config('app.payment_action',${row.id},true),set_config('app.payment_capability',${row.recoveryKey},true)`,
        );
        row.lifecycle = await reconcileLifecycle(tx, row, at, policy);
        const coordinated = await tx.execute<{ blocked: boolean }>(
          sql`select public.payment_reach_stop_requested(${row.id}::uuid,${businessId}::uuid) as blocked`,
        );
        if (coordinated.rows[0]?.blocked)
          throw new ApplicationError("CONFLICT");
        if (row.lifecycle.cancellation || row.lifecycle.state === "cancelled")
          return { action: paymentView(row), work: null };
        row.lifecycle.cancellation = {
          requestKey,
          requestedAt: at.toISOString(),
          actorId: actor.userId,
          timing: policy.cancellationTiming,
          access: policy.cancellationAccess,
          paidThroughAtRequest: row.lifecycle.paidThrough,
          status: "requested",
          confirmedAt: null,
          effectiveEnd: null,
        };
        await tx
          .update(subscriptionPayment)
          .set({ lifecycle: row.lifecycle, reconciliationPending: true })
          .where(eq(subscriptionPayment.id, row.id));
        await appendLifecycleEvent(
          tx,
          row,
          row.lifecycle,
          "cancellation_requested",
          `cancel:${requestKey}`,
          at,
          actor.userId,
          {
            kind: "cancellation_requested",
            channel: "in_app",
            status: "available",
          },
        );
        if (row.snapshot.upi)
          await assurePaymentActor(tx, actor, businessId, false);
        return { action: paymentView(row), work: workFor(row) };
      });
    },
    paymentMethodPrepared(
      actor: Actor,
      businessId: string,
      actionId: string,
      requestKey: string,
      at: Date,
      gateway: PaymentGateway,
    ) {
      return scoped(database, actor, businessId, async (tx) => {
        await lockBusiness(tx, businessId);
        await requireCapability(tx, actor, businessId, "billing.manage");
        const [row] = await tx
          .select()
          .from(subscriptionPayment)
          .where(
            and(
              eq(subscriptionPayment.id, actionId),
              eq(subscriptionPayment.businessId, businessId),
            ),
          );
        if (!row?.started || !row.checkout?.subscriptionId)
          throw new ApplicationError("NOT_FOUND");
        await tx.execute(
          sql`select set_config('app.payment_action',${row.id},true),set_config('app.payment_capability',${row.recoveryKey},true)`,
        );
        row.lifecycle = await reconcileLifecycle(
          tx,
          row,
          at,
          gateway.lifecyclePolicy,
        );
        if (row.lifecycle.cancellation || row.lifecycle.state === "cancelled")
          throw new ApplicationError("CONFLICT");
        await appendLifecycleEvent(
          tx,
          row,
          row.lifecycle,
          "payment_method_prepared",
          `payment-method:${requestKey}`,
          at,
          actor.userId,
          {
            kind: "payment_method_ready",
            channel: "in_app",
            status: "available",
          },
        );
      });
    },
    cancellationResult(
      work: Work,
      at: Date,
      policy: LifecyclePolicy | undefined,
      observation: LifecycleObservation,
    ) {
      return worker(work, async (tx, row) => {
        await reconcileLifecycle(tx, row, at, policy, observation, true);
      });
    },
    pollUnavailable(work: Work, at: Date) {
      return worker(work, async (tx, row) =>
        record(
          tx,
          row,
          "reconciliation_unavailable",
          row.state,
          "reconciliation_unavailable",
          at,
        ),
      );
    },
    readWork(work: Work) {
      return worker(work, async (tx, row) =>
        paymentActionSchema.parse({
          ...paymentView(row),
          settledPaymentIds: (
            await tx
              .select({ id: subscriptionPeriod.paymentId })
              .from(subscriptionPeriod)
              .where(eq(subscriptionPeriod.actionId, row.id))
          ).map((p) => p.id),
          reachRenewals: (
            await tx.execute<{ contracts: unknown }>(
              sql`select public.payment_reach_contract(${row.id}::uuid,${row.businessId}::uuid) as contracts`,
            )
          ).rows[0]?.contracts,
        }),
      );
    },
    async receive(event: AuthenticatedPaymentEvent, at: Date) {
      const o = event.observation;
      const target = await database.execute<Work>(
        o.operationKey
          ? sql`select * from public.subscription_payment_target(${o.provider},${o.account},${o.operationKey}::uuid)`
          : sql`select * from public.subscription_payment_reference_target(${o.provider},${o.account},${o.subscriptionId})`,
      );
      if (target.rows.length > 1) throw new ApplicationError("CONFLICT");
      let work: Work | undefined = target.rows[0];
      if (work && o.subscriptionId) {
        const action = await worker(work, async (_tx, row) => paymentView(row));
        if (
          action.checkout?.subscriptionId &&
          action.checkout.subscriptionId !== o.subscriptionId
        )
          work = undefined;
      }
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
          // Older receipts did not normalize lifecycle hints. The exact signed-byte hash
          // still has to match; keep their original stored observation immutable.
          const comparable = { ...o };
          if (previous.observation.native === undefined)
            delete comparable.native;
          if (
            previous.payloadHash !== event.payloadHash ||
            previous.actionId !== row.id ||
            !isDeepStrictEqual(previous.observation, comparable)
          )
            throw new ApplicationError("CONFLICT");
          if (row.started)
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
        if (row.started)
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
        if (observation?.review)
          return record(
            tx,
            row,
            "charge_evidence_conflict",
            "review_required",
            "provider_binding_mismatch",
            at,
            observation,
          );
        if (row.state === "confirmed" && !observation?.charge)
          return paymentView(row);
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
        const o = observation;
        const periods = await tx
          .select()
          .from(subscriptionPeriod)
          .where(eq(subscriptionPeriod.actionId, row.id));
        const previous = periods.find((p) => p.paymentId === o.paymentId);
        if (previous) {
          if (previous.charge && !isDeepStrictEqual(previous.charge, o))
            return record(
              tx,
              row,
              "charge_evidence_conflict",
              "review_required",
              "provider_binding_mismatch",
              at,
              o,
            );
          return paymentView(row);
        }
        const renewal =
          !!o.charge &&
          (o.charge.kind === "renewal" ||
            o.periodStart !== o.charge.subscriptionStart);
        const s = renewal
          ? await renewalSnapshot(tx, row, o, at)
          : row.snapshot;
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
              (row.checkout.customerId !== null &&
                o.customerId !== row.checkout.customerId) ||
              o.subscriptionId !== row.checkout.subscriptionId)) ||
          (o.currency !== null && o.currency !== s.quote.currency) ||
          (o.amountMinor !== null &&
            o.amountMinor !== s.tax.totals?.totalMinor) ||
          s.tax.status !== "calculated" ||
          (o.charge &&
            (!o.subscriptionId ||
              !row.checkout?.planId ||
              (o.charge.planId !== row.checkout.planId && !s.reachRenewal)))
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
        const nativeRenewal =
          renewal &&
          s.provider.key === "razorpay" &&
          row.snapshot.term.kind === "calendar_month" &&
          o.charge?.kind === "renewal";
        // A halted native subscription may resume with a later paid cycle while older
        // invoices remain unpaid. Require its real initial basis, never fund the gap.
        const renewalBasisKnown = nativeRenewal
          ? periods.some(
              (p) =>
                p.start.toISOString() === o.charge?.subscriptionStart &&
                p.snapshot.basis?.kind !== "renewal",
            )
          : periods.some(
              (p) =>
                p.end.getTime() === new Date(o.periodStart ?? "").getTime(),
            );
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
          (!renewal && periods.length > 0) ||
          (renewal && !renewalBasisKnown) ||
          new Date(o.periodStart) > new Date(o.paidAt) ||
          (!nativeRenewal && new Date(o.periodEnd) <= new Date(o.paidAt)) ||
          new Date(o.paidAt) > at ||
          (o.charge
            ? !monthlyPeriodMatches(
                o.charge.subscriptionStart,
                o.periodStart,
                o.periodEnd,
                s.provider.review?.plans.find(
                  (p) => p.planId === o.charge?.planId,
                )?.totalCount,
              )
            : new Date(periodEnd(o.periodStart, s.term)).getTime() !==
              new Date(o.periodEnd).getTime())
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
              !p.snapshot.adjustment &&
              !(
                s.replacement &&
                !s.upi &&
                p.actionId === s.replacement.originalActionId &&
                p.start >= new Date(s.replacement.start)
              ) &&
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
          charge: o,
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
      return authorizedAction(
        actor,
        businessId,
        actionId,
        operator,
        async (tx, row) => {
          await requestAudit(tx, row, actor, "reconciliation_requested", at);
          return workFor(row);
        },
      );
    },
    readAuthorizedAction(
      actor: Actor,
      businessId: string,
      actionId: string,
      operator = false,
    ) {
      return authorizedAction(
        actor,
        businessId,
        actionId,
        operator,
        async (_tx, row) => paymentView(row),
      );
    },
  };
}
