import { publicPaymentSnapshot } from "../subscription-payments/projection";
import { readBillingWorkspace } from "./billing-repository";
import { readTaxCatalog } from "./tax-repository";
import { evaluateTax } from "../application/tax-calculation";
import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./runtime";
import {
  scoped,
  lockBusiness,
  requireCapability,
  type Transaction,
} from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  pilotRecord,
  pilotEvent,
  pilotEffect,
  business,
  subscriptionPayment,
  subscriptionPaymentHistory,
  subscriptionPeriod,
  financialCase,
  financialCaseEvent,
  sellerDocument,
} from "./schema";
import {
  pilotPlanSchema,
  pilotEventSchema,
  type PilotPlan,
  type PilotGate,
  type PilotEvent,
} from "../models/pilots";
import { paymentSnapshotSchema } from "../models/subscription-payments";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
const snapshotSchema = z.object({
  business: z.object({ name: z.string(), offering: z.string() }),
  plan: pilotPlanSchema,
  payment: paymentSnapshotSchema,
});
export function createPilotRepository(database: Database, clock: Clock) {
  async function access<T>(
    actor: WorkIdentity,
    businessId: string,
    fn: (tx: Transaction) => Promise<T>,
    operator = false,
  ) {
    return scoped(database, actor, businessId, async (tx) => {
      await lockBusiness(tx, businessId);
      const role = await requireCapability(
        tx,
        actor,
        businessId,
        "billing.manage",
      );
      await requireSalesSession(tx, actor, clock.now(), role);
      await tx.execute(
        sql`select set_config('app.pilot_session',${actor.sessionId},true)`,
      );
      const allowed = await tx.execute<{ allowed: boolean }>(
        operator
          ? sql`select public.pilot_operator() as allowed`
          : sql`select public.pilot_authorized() as allowed`,
      );
      if (!allowed.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
      const result = await fn(tx);
      const current = await tx.execute<{ allowed: boolean }>(
        operator
          ? sql`select public.pilot_operator() as allowed`
          : sql`select public.pilot_authorized() as allowed`,
      );
      if (!current.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
      return result;
    });
  }
  async function read(tx: Transaction, businessId: string) {
    const rows = await tx
      .select()
      .from(pilotRecord)
      .where(eq(pilotRecord.businessId, businessId))
      .orderBy(asc(pilotRecord.at), asc(pilotRecord.id));
    const events = await tx
      .select()
      .from(pilotEvent)
      .where(eq(pilotEvent.businessId, businessId))
      .orderBy(asc(pilotEvent.position));
    const reservations = await tx
      .select()
      .from(pilotEffect)
      .where(eq(pilotEffect.businessId, businessId));
    return rows.map((r) => {
      const snapshot = snapshotSchema.parse(r.snapshot),
        history = events
          .filter((e) => e.pilotId === r.id)
          .map((e) => pilotEventSchema.parse({ ...e, at: e.at.toISOString() }));
      const usage = reservations.filter((e) => e.pilotId === r.id);
      const effort = history
        .filter((e) => e.kind === "effort")
        .map((e) =>
          z
            .object({
              cashMinor: z.string(),
              spendMinor: z.string(),
              seconds: z.number(),
            })
            .parse(e.data),
        );
      return {
        id: r.id,
        businessId: r.businessId,
        ...snapshot,
        events: history,
        usage: {
          cashMinor: String(
            usage.reduce((s, e) => s + e.cashMinor, 0n) +
              effort.reduce((s, e) => s + BigInt(e.cashMinor), 0n),
          ),
          spendMinor: String(
            usage.reduce((s, e) => s + e.spendMinor, 0n) +
              effort.reduce((s, e) => s + BigInt(e.spendMinor), 0n),
          ),
          seconds:
            usage.reduce((s, e) => s + e.seconds, 0) +
            effort.reduce((s, e) => s + e.seconds, 0),
          unknowns: [
            ...(usage.length
              ? [
                  "Provider cost and duration are conservative reserved ceilings, not measured actuals. Uncertain attempts stay reserved.",
                ]
              : []),
            "No unrecorded effort or cost is inferred as zero.",
          ],
        },
      };
    });
  }
  async function append(
    tx: Transaction,
    actor: WorkIdentity,
    businessId: string,
    pilotId: string,
    kind: PilotEvent["kind"],
    requestKey: string,
    data: Record<string, unknown>,
  ) {
    const [prior] = await tx
      .select()
      .from(pilotEvent)
      .where(
        and(
          eq(pilotEvent.businessId, businessId),
          eq(pilotEvent.requestKey, requestKey),
        ),
      );
    if (prior) {
      if (
        prior.pilotId !== pilotId ||
        prior.kind !== kind ||
        !isDeepStrictEqual(prior.data, data) ||
        prior.actorId !== actor.userId
      )
        throw new ApplicationError("CONFLICT");
      return;
    }
    await tx.insert(pilotEvent).values({
      id: randomUUID(),
      businessId,
      pilotId,
      kind,
      requestKey,
      actorId: actor.userId,
      data,
    });
  }
  async function financial(
    tx: Transaction,
    businessId: string,
    pilotId: string,
  ) {
    const records = await read(tx, businessId),
      p = records.find((p) => p.id === pilotId);
    if (!p) throw new ApplicationError("NOT_FOUND");
    const periods = await tx
      .select()
      .from(subscriptionPeriod)
      .where(eq(subscriptionPeriod.businessId, businessId));
    const actions = await tx
      .select()
      .from(subscriptionPayment)
      .where(eq(subscriptionPayment.businessId, businessId));
    const observations = await tx
      .select()
      .from(subscriptionPaymentHistory)
      .where(eq(subscriptionPaymentHistory.businessId, businessId));
    // Refunds are incurred facts for an exact capture, even after later renewal polls.
    const refunded = (r: typeof subscriptionPeriod.$inferSelect) =>
      observations.some((h) => {
        const o = h.detail.observation;
        return (
          h.actionId === r.actionId &&
          o?.status === "confirmed" &&
          o.provider === r.provider &&
          o.account === r.account &&
          o.paymentId === r.paymentId &&
          o.customerId === r.charge?.customerId &&
          o.amountMinor === r.charge?.amountMinor &&
          o.currency === r.charge?.currency &&
          BigInt(o.charge?.refundedMinor ?? "0") > 0n
        );
      });
    const cases = await tx
      .select()
      .from(financialCase)
      .where(eq(financialCase.businessId, businessId));
    const events = await tx
      .select()
      .from(financialCaseEvent)
      .where(eq(financialCaseEvent.businessId, businessId))
      .orderBy(asc(financialCaseEvent.position));
    const blocked = (periodId: string) =>
      cases.some(
        (c) =>
          c.periodId === periodId &&
          z
            .object({ access: z.string().optional() })
            .parse(
              events
                .filter((e) => e.caseId === c.id && e.kind === "observation")
                .at(-1)?.detail ?? {},
            ).access === "block_period",
      );
    const originalActionId =
      p.payment.pilotContinuation?.originalActionId ?? p.plan.paymentActionId;
    const contradictory = (r: typeof subscriptionPeriod.$inferSelect) => {
      const latest = actions.find((a) => a.id === r.actionId)?.observation;
      return latest?.paymentId === r.paymentId && latest.status !== "confirmed";
    };
    const initial = periods.find(
      (r) =>
        r.actionId === originalActionId &&
        !contradictory(r) &&
        r.snapshot.term.kind === "days" &&
        r.charge?.status === "confirmed" &&
        !refunded(r),
    );
    const renewal =
      initial && !blocked(initial.id)
        ? periods.find(
            (r) =>
              r.snapshot.pilotContinuation?.originalActionId ===
                initial.actionId &&
              r.snapshot.pilotContinuation.originalPeriodId === initial.id &&
              r.start >= initial.end &&
              r.snapshot.term.kind === "calendar_month" &&
              r.snapshot.basis?.kind === "renewal" &&
              isDeepStrictEqual(
                r.snapshot.quote.renewal,
                initial.snapshot.quote.renewal,
              ) &&
              r.charge?.status === "confirmed" &&
              !refunded(r) &&
              !blocked(r.id) &&
              !contradictory(r) &&
              !actions.find((a) => a.id === r.actionId)?.lifecycle
                ?.cancellation,
          )
        : undefined;
    const documents = await tx
      .select()
      .from(sellerDocument)
      .where(eq(sellerDocument.businessId, businessId));
    const pilotPeriods = periods.filter(
      (r) =>
        r.actionId === originalActionId ||
        r.snapshot.pilotContinuation?.originalActionId === originalActionId,
    );
    const accounting = {
      captures: pilotPeriods.map((r) => ({
        periodId: r.id,
        paymentId: r.paymentId,
        currency: r.snapshot.quote.currency,
        capturedMinor: r.charge?.amountMinor ?? null,
        netMinor: r.snapshot.tax.totals?.netMinor ?? null,
        taxMinor: r.snapshot.tax.totals?.taxMinor ?? null,
        currentlyBlocked: blocked(r.id) || refunded(r),
      })),
      adjustments: cases
        .filter((c) => pilotPeriods.some((r) => r.id === c.periodId))
        .map((c) => {
          const observation = events
            .filter((e) => e.caseId === c.id && e.kind === "observation")
            .at(-1)?.detail.observation;
          const credits = documents.filter(
            (d) => d.adjustmentId === c.id && d.kind === "credit_note",
          );
          const creditMinor = credits.reduce(
            (sum, d) => sum + BigInt(d.snapshot.totals.totalMinor),
            0n,
          );
          const cash = observation
            ? c.kind === "refund"
              ? observation.status === "processed"
                ? observation.amountMinor
                : null
              : observation.deductedMinor
            : null;
          return {
            caseId: c.id,
            kind: c.kind,
            status: observation?.status ?? "unconfirmed",
            currency:
              observation?.currency ?? c.intent.invoice.snapshot.currency,
            actualCashMinor: cash,
            issuedCreditMinor: String(creditMinor),
            residualMinor:
              cash !== null ? String(BigInt(cash) - creditMinor) : null,
            creditDocumentIds: credits.map((d) => d.id),
          };
        }),
    };
    const funded =
      p.payment.term.kind === "days"
        ? initial && !blocked(initial.id)
          ? initial
          : null
        : (renewal &&
            periods.find(
              (r) =>
                r.actionId === p.plan.paymentActionId &&
                r.snapshot.term.kind === "calendar_month" &&
                r.start <= new Date(p.plan.startsAt) &&
                r.end >= new Date(p.plan.endsAt) &&
                !blocked(r.id) &&
                !contradictory(r) &&
                !refunded(r),
            )) ||
          null;
    return {
      p,
      accounting,
      funded,
      initial: initial && !blocked(initial.id) ? initial : null,
      renewal: renewal ?? null,
    };
  }
  return {
    canRecord: (actor: WorkIdentity, businessId: string) =>
      access(
        actor,
        businessId,
        async (tx) =>
          (
            await tx.execute<{ allowed: boolean }>(
              sql`select public.pilot_operator() as allowed`,
            )
          ).rows[0]?.allowed === true,
      ),
    authorize: (actor: WorkIdentity, businessId: string) =>
      access(actor, businessId, async () => {}),
    read: (actor: WorkIdentity, businessId: string) =>
      access(actor, businessId, (tx) => read(tx, businessId)),
    prepare(
      actor: WorkIdentity,
      businessId: string,
      requestKey: string,
      plan: PilotPlan,
    ) {
      return access(
        actor,
        businessId,
        async (tx) => {
          const [previous] = await tx
            .select()
            .from(pilotRecord)
            .where(
              and(
                eq(pilotRecord.businessId, businessId),
                eq(pilotRecord.requestKey, requestKey),
              ),
            );
          if (previous) {
            if (
              !isDeepStrictEqual(
                snapshotSchema.parse(previous.snapshot).plan,
                plan,
              )
            )
              throw new ApplicationError("CONFLICT");
            return previous.id;
          }
          const [b] = await tx
            .select()
            .from(business)
            .where(eq(business.id, businessId));
          const [a] = await tx
            .select()
            .from(subscriptionPayment)
            .where(
              and(
                eq(subscriptionPayment.id, plan.paymentActionId),
                eq(subscriptionPayment.businessId, businessId),
              ),
            );
          if (!b || !a) throw new ApplicationError("NOT_FOUND");
          if (
            (a.snapshot.term.kind !== "days" &&
              !a.snapshot.pilotContinuation) ||
            a.snapshot.quote.currency !== plan.currency ||
            a.snapshot.quote.initial.kind !== "paid_pilot"
          )
            throw new ApplicationError("INVALID_INPUT");
          const snapshot = {
            business: { name: b.name, offering: b.offering },
            plan,
            payment: publicPaymentSnapshot(a.snapshot),
          };
          const id = randomUUID();
          await tx.insert(pilotRecord).values({
            id,
            businessId,
            requestKey,
            actorId: actor.userId,
            snapshot,
          });
          await append(tx, actor, businessId, id, "prepared", randomUUID(), {
            softwareOnly: true,
          });
          return id;
        },
        true,
      );
    },
    baseGates(actor: WorkIdentity, businessId: string, pilotId: string) {
      return access(actor, businessId, async (tx) => {
        const f = await financial(tx, businessId, pilotId),
          p = f.p;
        const [b] = await tx
          .select()
          .from(business)
          .where(eq(business.id, businessId));
        const stopped = await tx.execute<{ stopped: boolean }>(
          sql`select public.business_data_stopped(${businessId}::uuid) as stopped`,
        );
        const global = await tx.execute<{ ready: boolean }>(
          sql`select public.pilot_budget_ready() as ready`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0)),set_config('app.tax_calculation','true',true)`,
        );
        const tax = evaluateTax(
          p.payment.tax.input,
          await readBillingWorkspace(tx, businessId, clock.now()),
          await readTaxCatalog(tx),
          clock.now(),
          p.payment.provider.mode === "test"
            ? "fixture"
            : p.payment.provider.mode,
        );
        const taxCurrent =
          tax.status === "calculated" &&
          isDeepStrictEqual(tax.lines, p.payment.tax.lines) &&
          isDeepStrictEqual(tax.totals, p.payment.tax.totals);
        const classes = new Set(
          p.plan.capabilities.map((c) =>
            ["inquiry_email", "outreach_email", "whatsapp"].includes(c)
              ? "automation"
              : c,
          ),
        );
        const ceilingsReady = [...classes].every((c) => {
          const ceiling = p.plan.ceilings[c as keyof typeof p.plan.ceilings];
          return (
            !!ceiling &&
            (p.plan.currency === "INR" || ceiling.globalSpendInrMicros !== null)
          );
        });
        const gate = (
          capability: string,
          ready: boolean,
          reasons: string[],
          destination: string,
        ): PilotGate => ({
          capability,
          ready,
          reasons: ready ? [] : reasons,
          destination,
          checkedAt: clock.now().toISOString(),
        });
        return [
          gate("authority", true, [], "/security"),
          gate(
            "operating_approval",
            p.events.some((e) => e.kind === "approved") &&
              !p.events.some((e) => e.kind === "stopped") &&
              new Date(p.plan.startsAt) <= clock.now() &&
              new Date(p.plan.endsAt) > clock.now(),
            [
              "Approve the exact frozen operating plan within its agreed window. A stopped or expired plan needs a new explicit bounded approval, including for monthly continuation.",
            ],
            `/businesses/${businessId}/pilots`,
          ),
          gate(
            "remaining_limits",
            ceilingsReady &&
              [...classes].every((c) => {
                const bound =
                  p.plan.ceilings[c as keyof typeof p.plan.ceilings];
                return (
                  !!bound &&
                  BigInt(p.usage.cashMinor) + BigInt(bound.cashMinor) <=
                    BigInt(p.plan.cashLimitMinor) &&
                  BigInt(p.usage.spendMinor) + BigInt(bound.spendMinor) <=
                    BigInt(p.plan.spendLimitMinor) &&
                  p.usage.seconds + bound.seconds <= p.plan.timeLimitSeconds
                );
              }),
            [
              "The remaining approved cash, spend or time cannot cover a next selected operation. Record actual evidence and obtain a new explicit bounded plan; unknown inputs are not zero.",
            ],
            `/businesses/${businessId}/pilots`,
          ),
          gate(
            "limits",
            ceilingsReady,
            [
              "Provide an evidence-backed cash, spend and duration ceiling for every selected provider path. USD paths also require an approved INR spend ceiling for the independent global cap.",
            ],
            `/businesses/${businessId}/pilots`,
          ),
          gate(
            "billing_tax",
            taxCurrent,
            [
              "Current billing identity, evidence and applicable tax rules must still support the frozen original charge. Resolve current Billing and tax setup; the original financial record remains unchanged.",
            ],
            `/businesses/${businessId}/billing`,
          ),
          gate(
            "business",
            b?.name === p.business.name && b?.offering === p.business.offering,
            ["Business identity or offering changed; prepare a new pilot."],
            `/businesses/${businessId}`,
          ),
          gate(
            "payment",
            !!f.funded &&
              new Date(p.plan.startsAt) >= f.funded.start &&
              new Date(p.plan.endsAt) <= f.funded.end,
            [
              "A genuine, exact captured pilot payment with its frozen tax and allowances is required; checkout or mandate authorization is insufficient.",
            ],
            `/businesses/${businessId}/subscription-payments`,
          ),
          gate(
            "offboarding",
            !stopped.rows[0]?.stopped,
            ["Business connections are stopped. Review Data and offboarding."],
            `/businesses/${businessId}/data`,
          ),
          gate(
            "global_budget",
            !!global.rows[0]?.ready,
            [
              "A current global cost cap and priced, covered or explicitly bounded observed native sources are required. A costs operator must normalize new facts and resolve missing or exhausted limits; unrecorded bills remain unknown.",
            ],
            "/platform/costs",
          ),
        ];
      });
    },
    event(
      actor: WorkIdentity,
      businessId: string,
      pilotId: string,
      kind: PilotEvent["kind"],
      requestKey: string,
      data: Record<string, unknown>,
    ) {
      return access(
        actor,
        businessId,
        async (tx) => {
          const f = await financial(tx, businessId, pilotId),
            history = f.p.events;
          if (
            kind === "activated" &&
            (!f.initial ||
              !f.funded ||
              !history.some((e) => e.kind === "approved") ||
              history.some((e) => e.kind === "stopped"))
          )
            throw new ApplicationError("CONFLICT");
          if (kind === "activated") {
            const now = await tx.execute<{ now: string }>(
              sql`select clock_timestamp() as now`,
            );
            const at = new Date(now.rows[0].now);
            if (
              new Date(f.p.plan.startsAt) > at ||
              new Date(f.p.plan.endsAt) <= at
            )
              throw new ApplicationError("CONFLICT");
            const others = await read(tx, businessId);
            if (
              others.some(
                (p) =>
                  p.id !== pilotId &&
                  p.events.some((e) => e.kind === "activated") &&
                  !p.events.some((e) => e.kind === "stopped"),
              )
            )
              throw new ApplicationError("CONFLICT");
          }
          if (
            (kind === "renewal" || kind === "reuse") &&
            (!f.renewal || !history.some((e) => e.kind === "results"))
          )
            throw new ApplicationError("CONFLICT");
          if (kind === "reuse") {
            await requireCapability(
              tx,
              actor,
              String(data.secondBusinessId),
              "billing.manage",
            );
            if (!history.some((e) => e.kind === "renewal"))
              throw new ApplicationError("CONFLICT");
          }
          await append(
            tx,
            actor,
            businessId,
            pilotId,
            kind,
            requestKey,
            kind === "renewal"
              ? {
                  periodId: f.renewal!.id,
                  paymentId: f.renewal!.paymentId,
                  amountMinor: f.renewal!.charge!.amountMinor,
                  paidAt: f.renewal!.charge!.paidAt,
                }
              : data,
          );
          return pilotId;
        },
        kind !== "approved",
      );
    },
    financial: (actor: WorkIdentity, businessId: string, pilotId: string) =>
      access(actor, businessId, (tx) => financial(tx, businessId, pilotId)),
  };
}
