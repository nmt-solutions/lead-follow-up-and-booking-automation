import { and, asc, eq, sql } from "drizzle-orm";
import {
  platformOperator,
  financialCase,
  financialCaseEvent,
  financialReceipt,
  sellerDocument,
  subscriptionPeriod,
} from "./schema";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  adjustmentViewSchema,
  disputeIntentSchema,
  creditBasisSchema,
  reviewedNativeAmount,
  type ReviewCredit,
  type FinancialReceipt,
  type DisputeIntent,
  type ReviewAdjustment,
  type AdjustmentIntent,
  type FinancialWork,
  type AdjustmentObservation,
  type AdjustmentPolicy,
} from "../models/financial-adjustments";
import { sellerDocumentSchema } from "../models/seller-documents";
import { paidPeriodSchema } from "../models/subscription-payments";
import { allocateCredit } from "../application/seller-document-credit";
import { z } from "zod";

type Identity = Actor & { work?: FinancialWork };
type Case = typeof financialCase.$inferSelect;
type Event = typeof financialCaseEvent.$inferSelect;
function creditBasis(events: Event[]) {
  const latest = events.filter((e) => e.kind === "credit_review").at(-1);
  return latest ? creditBasisSchema.parse(latest.detail.review) : null;
}
function reviewRequired(events: Event[]) {
  return (
    (events.filter((e) => e.kind === "review_issue").at(-1)?.position ?? 0) >
    (events.filter((e) => e.kind === "review_resolved").at(-1)?.position ?? 0)
  );
}
export function financialView(row: Case, events: Event[]) {
  const approved = creditBasis(events);
  const o = events.filter((e) => e.kind === "observation").at(-1),
    started =
      (events.filter((e) => e.kind === "started").at(-1)?.position ?? 0) >
      (events.filter((e) => e.kind === "not_attempted").at(-1)?.position ?? 0);
  return adjustmentViewSchema.parse({
    id: row.id,
    businessId: row.businessId,
    periodId: row.periodId,
    invoiceId: row.invoiceId,
    invoiceNumber: row.intent.invoice.number,
    paymentId: row.intent.period.paymentId,
    kind: row.kind,
    currency: row.intent.invoice.snapshot.currency,
    amountMinor: reviewedNativeAmount(row.intent),
    state:
      o?.detail.observation?.status ??
      (events.some((e) => e.kind === "withdrawn")
        ? "withdrawn"
        : started
          ? "unknown"
          : "reviewed"),
    started,
    observation: o?.detail.observation ?? null,
    access: o?.detail.access ?? "preserve",
    creditDocumentId:
      events.find((e) => e.kind === "credit")?.detail.documentId ?? null,
    creditAmountMinor:
      approved?.allocation.totals.totalMinor ??
      row.intent.allocation.totals.totalMinor,
    creditState: events.some((e) => e.kind === "credit")
      ? "issued"
      : o?.detail.observation?.status === "processed"
        ? "pending"
        : o?.detail.observation?.status === "lost"
          ? !row.intent.policy.disputeLostCredit
            ? "not_required"
            : approved ||
                o.detail.observation.deductedMinor ===
                  row.intent.allocation.totals.totalMinor
              ? "pending"
              : "review_required"
          : "not_applicable",
    reviewRequired: reviewRequired(events),
    at: row.at.toISOString(),
    actions: events
      .filter((e) => e.kind === "dispute_action")
      .map((e) => {
        const command = disputeIntentSchema.parse(e.detail.command);
        return {
          requestKey: command.input.requestKey,
          action: command.input.action,
          state: events.some(
            (r) => r.key === `resolved:${command.input.requestKey}`,
          )
            ? "confirmed"
            : events.some(
                  (r) => r.key === `unattempted:${command.input.requestKey}`,
                )
              ? "not_attempted"
              : "unknown",
        };
      }),
    notices: events
      .filter((e) => typeof e.detail.message === "string")
      .map((e) => ({
        id: e.id,
        channel: "in_app",
        status: "available",
        message: e.detail.message,
        at: e.at.toISOString(),
      })),
  });
}
function document(row: typeof sellerDocument.$inferSelect) {
  return sellerDocumentSchema.parse({
    ...row,
    at: row.at.toISOString(),
    retainUntil: row.retainUntil.toISOString(),
    artifact: {
      state: row.artifactState,
      failure: row.failure,
      sha256: row.sha256,
      bytes: row.bytes,
    },
  });
}
async function access(tx: Transaction, actor: Identity, businessId: string) {
  if (!actor.work) return requireRefundOperator(tx, actor);
  if (actor.work.business_id !== businessId)
    throw new ApplicationError("FORBIDDEN");
  await tx.execute(
    sql`select set_config('app.financial_case',${actor.work.id},true),set_config('app.financial_capability',${actor.work.recovery_key},true)`,
  );
  const r = await tx.execute<{ allowed: boolean }>(
    sql`select public.financial_worker_authorized(${actor.work.id}::uuid,${businessId}::uuid) as allowed`,
  );
  if (!r.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
}
async function events(tx: Transaction, id: string) {
  return tx
    .select()
    .from(financialCaseEvent)
    .where(eq(financialCaseEvent.caseId, id))
    .orderBy(asc(financialCaseEvent.position));
}
async function target(tx: Transaction, id: string, businessId: string) {
  const [row] = await tx
    .select()
    .from(financialCase)
    .where(
      and(eq(financialCase.id, id), eq(financialCase.businessId, businessId)),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
async function append(
  tx: Transaction,
  row: Case,
  actor: Identity,
  key: string,
  kind: string,
  detail: Event["detail"],
  at: Date,
) {
  await tx
    .insert(financialCaseEvent)
    .values({
      id: randomUUID(),
      caseId: row.id,
      businessId: row.businessId,
      key,
      kind,
      detail,
      actorId: actor.work ? null : actor.userId,
      at,
    })
    .onConflictDoNothing({
      target: [financialCaseEvent.caseId, financialCaseEvent.key],
    });
}
async function issue(
  tx: Transaction,
  row: Case,
  actor: Identity,
  list: Event[],
  code: string,
  at: Date,
) {
  if (
    reviewRequired(list) &&
    list.filter((e) => e.kind === "review_issue").at(-1)?.detail.code === code
  )
    return;
  await append(
    tx,
    row,
    actor,
    `issue:${randomUUID()}`,
    "review_issue",
    { code },
    at,
  );
}
function released(row: Case, list: Event[]) {
  const v = financialView(row, list);
  return (
    !!v.creditDocumentId ||
    ["withdrawn", "failed", "won", "closed"].includes(v.state)
  );
}

export async function requireRefundOperator(tx: Transaction, actor: Actor) {
  const [op] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!op?.refunds) throw new ApplicationError("FORBIDDEN");
}
export function createFinancialAdjustmentRepository(database: Database) {
  return {
    authorize: (actor: Actor, businessId: string, operator = true) =>
      scoped(database, actor, businessId, async (tx) => {
        if (operator) await requireRefundOperator(tx, actor);
        else await requireCapability(tx, actor, businessId, "billing.manage");
      }),
    queue: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        await requireRefundOperator(tx, actor);
        const periods = await tx
          .select()
          .from(subscriptionPeriod)
          .orderBy(asc(subscriptionPeriod.start));
        const grouped = new Map<string, { businessId: string; name: string }>();
        for (const p of periods)
          grouped.set(p.businessId, {
            businessId: p.businessId,
            name:
              p.snapshot.tax.billing.current?.profile.legalName ?? p.businessId,
          });
        return [...grouped.values()];
      }),
    notificationFeed: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        await requireRefundOperator(tx, actor);
        const list = await tx
          .select()
          .from(financialCaseEvent)
          .orderBy(asc(financialCaseEvent.position));
        return list
          .filter((e) => typeof e.detail.message === "string")
          .map((e) => ({
            id: e.id,
            businessId: e.businessId,
            caseId: e.caseId,
            at: e.at.toISOString(),
            notice: {
              channel: "in_app" as const,
              status: "available" as const,
              message: String(e.detail.message),
            },
          }));
      }),
    workspace: (actor: Actor, businessId: string, operator: boolean) =>
      scoped(database, actor, businessId, async (tx) => {
        if (!operator) {
          await requireCapability(tx, actor, businessId, "billing.manage");
          const r = await tx.execute<{ cases: unknown }>(
            sql`select public.financial_public(${businessId}::uuid) as cases`,
          );
          return {
            cases: z.array(adjustmentViewSchema).parse(r.rows[0]?.cases),
            invoices: [],
          };
        }
        await requireRefundOperator(tx, actor);
        const rows = await tx
          .select()
          .from(financialCase)
          .where(eq(financialCase.businessId, businessId))
          .orderBy(asc(financialCase.position));
        const result = [];
        for (const row of rows)
          result.push(financialView(row, await events(tx, row.id)));
        const docs = await tx
          .select()
          .from(sellerDocument)
          .where(
            and(
              eq(sellerDocument.businessId, businessId),
              eq(sellerDocument.kind, "invoice"),
            ),
          );
        return { cases: result, invoices: docs.map(document) };
      }),
    review: (
      actor: Actor,
      businessId: string,
      input: ReviewAdjustment,
      policy: AdjustmentPolicy,
      at: Date,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const rows = await tx
            .select()
            .from(financialCase)
            .where(eq(financialCase.businessId, businessId))
            .orderBy(asc(financialCase.position));
          const prior = rows.find((r) => r.requestKey === input.requestKey);
          if (prior) {
            if (
              prior.actorId !== actor.userId ||
              !isDeepStrictEqual(prior.intent.input, input)
            )
              throw new ApplicationError("CONFLICT");
            return financialView(prior, await events(tx, prior.id));
          }
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('financial-adjustment-policy',0))`,
          );
          const previousPolicies = await tx
            .select({ intent: financialCase.intent })
            .from(financialCase)
            .where(
              sql`${financialCase.intent}->'policy'->>'id'=${policy.id} and ${financialCase.intent}->'policy'->>'version'=${String(policy.version)}`,
            );
          if (
            previousPolicies.some(
              (p) => !isDeepStrictEqual(p.intent.policy, policy),
            )
          )
            throw new ApplicationError("SETUP_REQUIRED");
          const [source] = await tx
            .select()
            .from(sellerDocument)
            .where(
              and(
                eq(sellerDocument.businessId, businessId),
                eq(sellerDocument.id, input.invoiceId),
                eq(sellerDocument.kind, "invoice"),
              ),
            );
          if (!source) throw new ApplicationError("NOT_FOUND");
          const invoice = document(source),
            [p] = await tx
              .select()
              .from(subscriptionPeriod)
              .where(
                and(
                  eq(subscriptionPeriod.id, invoice.periodId),
                  eq(subscriptionPeriod.businessId, businessId),
                ),
              );
          if (
            !p ||
            !p.charge ||
            p.charge.status !== "confirmed" ||
            p.paymentId !== invoice.snapshot.source.paymentId ||
            p.snapshot.provider.key !== "razorpay" ||
            p.snapshot.provider.account !== policy.account ||
            p.snapshot.provider.mode !== policy.mode
          )
            throw new ApplicationError("CONFLICT");
          const period = paidPeriodSchema.parse({
            ...p,
            start: p.start.toISOString(),
            end: p.end.toISOString(),
          });
          const credited = (
            await tx
              .select()
              .from(sellerDocument)
              .where(eq(sellerDocument.originalId, invoice.id))
          ).map(document);
          const reservations = [];
          for (const c of rows.filter((c) => c.invoiceId === invoice.id))
            if (
              !credited.some(
                (d) => d.snapshot.adjustment?.adjustmentId === c.id,
              ) &&
              !released(c, await events(tx, c.id))
            ) {
              const approved = creditBasis(await events(tx, c.id));
              reservations.push({
                ...invoice,
                snapshot: {
                  ...invoice.snapshot,
                  lines:
                    approved?.allocation.lines ?? c.intent.allocation.lines,
                  totals:
                    approved?.allocation.totals ?? c.intent.allocation.totals,
                },
              });
            }
          const id = randomUUID(),
            allocation = allocateCredit(
              invoice,
              [...credited, ...reservations],
              {
                invoiceId: invoice.id,
                periodId: period.id,
                paymentId: period.paymentId,
                requestKey: input.requestKey,
                adjustmentId: id,
                source: { kind: input.kind, reference: id },
                reason: input.reason,
                evidence: input.evidence,
                lines: input.lines,
              },
            );
          const amount = BigInt(allocation.totals.totalMinor);
          if (
            amount <= 0n ||
            amount > BigInt(Number.MAX_SAFE_INTEGER) ||
            (input.disputeAmountMinor !== undefined &&
              BigInt(input.disputeAmountMinor) >
                BigInt(invoice.snapshot.totals.totalMinor))
          )
            throw new ApplicationError("CONFLICT");
          const intent: AdjustmentIntent = {
            input,
            invoice,
            period,
            policy,
            key: id,
            body: JSON.stringify({
              amount: Number(amount),
              speed: "normal",
              receipt: id,
              notes: { financial_case: id },
            }),
            allocation,
          };
          const [row] = await tx
            .insert(financialCase)
            .values({
              id,
              businessId,
              periodId: period.id,
              invoiceId: invoice.id,
              requestKey: input.requestKey,
              recoveryKey: randomUUID(),
              kind: input.kind,
              nativeDisputeId: input.disputeId ?? null,
              intent,
              actorId: actor.userId,
              at,
            })
            .returning();
          return financialView(row, []);
        },
        { lock: true },
      ),
    reviewCredit: (
      actor: Actor,
      businessId: string,
      input: ReviewCredit,
      at: Date,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const [operator] = await tx
            .select()
            .from(platformOperator)
            .where(eq(platformOperator.userId, actor.userId));
          if (!operator?.documents) throw new ApplicationError("FORBIDDEN");
          const row = await target(tx, input.caseId, businessId),
            list = await events(tx, row.id),
            view = financialView(row, list);
          const prior = list.find(
            (e) => e.key === `credit-review:${input.requestKey}`,
          );
          if (prior) {
            if (
              prior.actorId !== actor.userId ||
              !isDeepStrictEqual(
                creditBasisSchema.parse(prior.detail.review).input,
                input,
              )
            )
              throw new ApplicationError("CONFLICT");
            return view;
          }
          const observation = view.observation;
          if (
            view.reviewRequired ||
            !observation ||
            !(
              observation.status === "processed" ||
              (observation.status === "lost" &&
                row.intent.policy.disputeLostCredit)
            ) ||
            view.creditDocumentId
          )
            throw new ApplicationError("CONFLICT");
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended('seller-documents',0))`,
          );
          const docs = (
            await tx
              .select()
              .from(sellerDocument)
              .where(eq(sellerDocument.originalId, row.invoiceId))
          ).map(document);
          if (docs.some((d) => d.snapshot.adjustment?.adjustmentId === row.id))
            throw new ApplicationError("CONFLICT");
          const reservations = [],
            earlierReservations = [];
          const siblings = await tx
            .select()
            .from(financialCase)
            .where(eq(financialCase.invoiceId, row.invoiceId))
            .orderBy(asc(financialCase.position));
          for (const sibling of siblings)
            if (
              sibling.id !== row.id &&
              !docs.some(
                (d) => d.snapshot.adjustment?.adjustmentId === sibling.id,
              ) &&
              !released(sibling, await events(tx, sibling.id))
            ) {
              const basis = creditBasis(await events(tx, sibling.id));
              const reservation = {
                ...row.intent.invoice,
                snapshot: {
                  ...row.intent.invoice.snapshot,
                  lines:
                    basis?.allocation.lines ?? sibling.intent.allocation.lines,
                  totals:
                    basis?.allocation.totals ??
                    sibling.intent.allocation.totals,
                },
              };
              reservations.push(reservation);
              if (sibling.position < row.position)
                earlierReservations.push(reservation);
            }
          for (const requested of input.lines) {
            const line = row.intent.invoice.snapshot.lines.find(
              (l) => l.input.id === requested.lineId,
            );
            const reservedNet = [...docs, ...reservations]
              .flatMap((d) => d.snapshot.lines)
              .filter((l) => l.input.id === requested.lineId)
              .reduce((sum, l) => sum + BigInt(l.netMinor), 0n);
            if (
              !line ||
              reservedNet + BigInt(requested.netMinor) > BigInt(line.netMinor)
            )
              throw new ApplicationError("CONFLICT");
          }
          const allocation = allocateCredit(
            row.intent.invoice,
            [...docs, ...earlierReservations],
            {
              invoiceId: row.invoiceId,
              periodId: row.periodId,
              paymentId: row.intent.period.paymentId,
              requestKey: row.intent.key,
              adjustmentId: row.id,
              source: { kind: row.kind, reference: observation.nativeId },
              reason: input.reason,
              evidence: input.evidence,
              lines: input.lines,
            },
          );
          const actual = BigInt(
              observation.status === "processed"
                ? observation.amountMinor
                : observation.deductedMinor,
            ),
            gross = BigInt(allocation.totals.totalMinor);
          if (gross <= 0n || gross > actual)
            throw new ApplicationError("CONFLICT");
          await append(
            tx,
            row,
            actor,
            `credit-review:${input.requestKey}`,
            "credit_review",
            {
              review: {
                input,
                allocation,
                actualMinor: String(actual),
                uncreditedDifferenceMinor: String(actual - gross),
                actorId: actor.userId,
                at: at.toISOString(),
              },
            },
            at,
          );
          return financialView(row, await events(tx, row.id));
        },
        { lock: true },
      ),
    read: (actor: Identity, businessId: string, id: string) =>
      scoped(database, actor, businessId, async (tx) => {
        await access(tx, actor, businessId);
        const row = await target(tx, id, businessId),
          list = await events(tx, id);
        return { row, events: list, view: financialView(row, list) };
      }),
    start: (
      actor: Actor,
      businessId: string,
      id: string,
      at: Date,
      nativeRefundedMinor: string,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const row = await target(tx, id, businessId),
            list = await events(tx, id);
          if (financialView(row, list).started) return false;
          if (financialView(row, list).observation) return false;
          if (list.some((e) => e.kind === "withdrawn"))
            throw new ApplicationError("CONFLICT");
          const siblings = await tx
            .select()
            .from(financialCase)
            .where(
              and(
                eq(financialCase.businessId, businessId),
                eq(financialCase.periodId, row.periodId),
              ),
            );
          let refunded = 0n,
            disputed = 0n;
          for (const sibling of siblings)
            if (sibling.id !== row.id) {
              const view = financialView(sibling, await events(tx, sibling.id));
              if (
                sibling.kind === "refund" &&
                view.started &&
                ["pending", "unknown"].includes(view.state)
              )
                throw new ApplicationError("CONFLICT");
              if (sibling.kind === "refund" && view.state === "processed")
                refunded += BigInt(view.amountMinor);
              if (
                sibling.kind === "dispute" &&
                !["won", "closed", "withdrawn"].includes(view.state)
              )
                disputed += BigInt(
                  view.state === "lost"
                    ? (view.observation?.deductedMinor ?? "0")
                    : view.amountMinor,
                );
            }
          const native = BigInt(nativeRefundedMinor);
          if (
            (refunded > native ? refunded : native) +
              disputed +
              BigInt(row.intent.allocation.totals.totalMinor) >
            BigInt(row.intent.invoice.snapshot.totals.totalMinor)
          )
            throw new ApplicationError("CONFLICT");
          await append(
            tx,
            row,
            actor,
            `start:${randomUUID()}`,
            "started",
            {
              message:
                "Refund requested; provider outcome awaiting confirmation.",
            },
            at,
          );
          return true;
        },
        { lock: true },
      ),
    withdraw: (actor: Actor, businessId: string, id: string, at: Date) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const row = await target(tx, id, businessId),
            list = await events(tx, id);
          if (
            financialView(row, list).started ||
            list.some((e) => ["dispute_action", "observation"].includes(e.kind))
          )
            throw new ApplicationError("CONFLICT");
          await append(tx, row, actor, "withdrawn", "withdrawn", {}, at);
          return financialView(row, await events(tx, id));
        },
        { lock: true },
      ),
    startDispute: (
      actor: Actor,
      businessId: string,
      id: string,
      command: DisputeIntent,
      at: Date,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const row = await target(tx, id, businessId),
            list = await events(tx, id);
          if (row.kind !== "dispute")
            throw new ApplicationError("INVALID_INPUT");
          const previous = list.find(
            (e) => e.key === `action:${command.input.requestKey}`,
          );
          if (previous) {
            if (
              previous.actorId !== actor.userId ||
              !isDeepStrictEqual(previous.detail.command, command)
            )
              throw new ApplicationError("CONFLICT");
            return false;
          }
          if (
            list.some(
              (e) =>
                e.kind === "dispute_action" &&
                !list.some((r) =>
                  [
                    `resolved:${disputeIntentSchema.parse(e.detail.command).input.requestKey}`,
                    `unattempted:${disputeIntentSchema.parse(e.detail.command).input.requestKey}`,
                  ].includes(r.key),
                ),
            )
          )
            throw new ApplicationError("CONFLICT");
          await append(
            tx,
            row,
            actor,
            `action:${command.input.requestKey}`,
            "dispute_action",
            { command },
            at,
          );
          return true;
        },
        { lock: true },
      ),
    notAttempted: (work: FinancialWork, at: Date, requestKey?: string) =>
      scoped(
        database,
        { userId: "" },
        work.business_id,
        async (tx) => {
          const actor = { userId: "", work };
          await access(tx, actor, work.business_id);
          const row = await target(tx, work.id, work.business_id);
          await append(
            tx,
            row,
            actor,
            requestKey
              ? `unattempted:${requestKey}`
              : `unattempted:${randomUUID()}`,
            requestKey ? "dispute_unattempted" : "not_attempted",
            {
              message:
                "The request is paused for operator review and has not been sent to the payment provider.",
            },
            at,
          );
        },
        { lock: true },
      ),
    disputeConfirmed: (
      actor: Identity,
      businessId: string,
      id: string,
      requestKey: string,
      at: Date,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await access(tx, actor, businessId);
          const row = await target(tx, id, businessId),
            list = await events(tx, id),
            event = list.find((e) => e.key === `action:${requestKey}`);
          if (!event) throw new ApplicationError("CONFLICT");
          const command = disputeIntentSchema.parse(event.detail.command);
          await append(
            tx,
            row,
            actor,
            `resolved:${requestKey}`,
            "dispute_confirmed",
            {
              message: `Dispute ${command.input.action === "draft" ? "evidence draft saved" : command.input.action === "submit" ? "evidence submitted for review" : "acceptance outcome confirmed"}.`,
            },
            at,
          );
        },
        { lock: true },
      ),
    record: (
      actor: Identity,
      businessId: string,
      id: string,
      observation: AdjustmentObservation | null,
      at: Date,
      skip = 0,
      allowReopen = false,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await access(tx, actor, businessId);
          const row = await target(tx, id, businessId),
            list = await events(tx, id),
            previous = financialView(row, list).observation;
          if (!observation) {
            await append(
              tx,
              row,
              actor,
              `scan:${randomUUID()}`,
              "scan",
              { skip },
              at,
            );
            return;
          }
          if (
            observation.paymentId !== row.intent.period.paymentId ||
            observation.currency !== row.intent.invoice.snapshot.currency ||
            observation.amountMinor !== reviewedNativeAmount(row.intent) ||
            (previous && previous.nativeId !== observation.nativeId)
          )
            throw new ApplicationError("CONFLICT");
          const terminal = ["processed", "failed", "won", "lost", "closed"];
          if (
            previous &&
            ((terminal.includes(previous.status) &&
              previous.status !== observation.status) ||
              (previous.status === "under_review" &&
                observation.status === "open" &&
                !allowReopen) ||
              (previous.status === "lost" &&
                BigInt(previous.deductedMinor) > 0n &&
                previous.deductedMinor !== observation.deductedMinor))
          ) {
            await issue(
              tx,
              row,
              actor,
              list,
              "native_financial_evidence_conflict",
              at,
            );
            return;
          }
          const policy = row.intent.policy;
          let accessEffect: "preserve" | "block_period" = "preserve";
          if (observation.status === "processed") {
            const result = await tx.execute<{ amount: string }>(
              sql`select public.financial_refunded(${row.id}::uuid,${businessId}::uuid)::text as amount`,
            );
            const refunded =
              BigInt(observation.amountMinor) +
              BigInt(result.rows[0]?.amount ?? "0");
            accessEffect =
              refunded === BigInt(row.intent.invoice.snapshot.totals.totalMinor)
                ? policy.fullRefundAccess
                : policy.partialRefundAccess;
            if (previous?.status === "processed")
              accessEffect =
                list.filter((e) => e.kind === "observation").at(-1)?.detail
                  .access ?? accessEffect;
          }
          if (["open", "under_review"].includes(observation.status))
            accessEffect = policy.disputeOpenAccess;
          if (observation.status === "lost")
            accessEffect = policy.disputeLostAccess;
          if (observation.status === "won")
            accessEffect = policy.disputeWonAccess;
          if (observation.status === "closed")
            accessEffect = policy.disputeClosedAccess;
          await append(
            tx,
            row,
            actor,
            `checked:${randomUUID()}`,
            "checkpoint",
            {},
            at,
          );
          if (reviewRequired(list))
            await append(
              tx,
              row,
              actor,
              `resolved-review:${randomUUID()}`,
              "review_resolved",
              {},
              at,
            );
          if (
            previous &&
            isDeepStrictEqual(
              { ...previous, observedAt: "" },
              { ...observation, observedAt: "" },
            ) &&
            list.filter((e) => e.kind === "observation").at(-1)?.detail
              .access === accessEffect
          )
            return;
          const key = `native:${observation.nativeId}:${observation.status}:${observation.phase ?? "refund"}:${observation.deductedMinor}:${observation.submittedAt ?? "draft"}:after:${list.filter((e) => e.kind === "observation").at(-1)?.id ?? "initial"}`;
          await append(
            tx,
            row,
            actor,
            key,
            "observation",
            {
              observation,
              access: accessEffect,
              message: `${row.kind === "refund" ? "Refund" : "Dispute"} ${observation.status.replaceAll("_", " ")}. ${accessEffect === "block_period" ? "Automation for this paid period is blocked under the reviewed policy." : "Paid access policy preserves this period."}`,
            },
            at,
          );
          if (
            observation.status === "processed" ||
            (observation.status === "lost" &&
              BigInt(observation.deductedMinor) > 0n)
          )
            await append(
              tx,
              row,
              actor,
              "financial_effect",
              "financial_effect",
              {
                source: row.kind,
                nativeId: observation.nativeId,
                paymentId: row.intent.period.paymentId,
                invoiceId: row.invoiceId,
                periodId: row.periodId,
                currency: observation.currency,
                actualMinor:
                  row.kind === "refund"
                    ? observation.amountMinor
                    : observation.deductedMinor,
                originalTax: {
                  id: row.intent.invoice.snapshot.financial.tax.id,
                  lines: row.intent.invoice.snapshot.lines,
                  totals: row.intent.invoice.snapshot.totals,
                },
                allocation: row.intent.allocation,
                creditApplicable:
                  row.kind === "refund" || policy.disputeLostCredit,
                bankSettlementConfirmed: false,
              },
              at,
            );
        },
        { lock: true },
      ),
    recordIssue: (work: FinancialWork, code: string, at: Date) =>
      scoped(
        database,
        { userId: "" },
        work.business_id,
        async (tx) => {
          const actor = { userId: "", work };
          await access(tx, actor, work.business_id);
          const row = await target(tx, work.id, work.business_id);
          await issue(tx, row, actor, await events(tx, row.id), code, at);
          await append(
            tx,
            row,
            actor,
            `checked:${randomUUID()}`,
            "checkpoint",
            {},
            at,
          );
        },
        { lock: true },
      ),
    creditRecorded: (
      actor: Actor,
      businessId: string,
      id: string,
      documentId: string,
      at: Date,
    ) =>
      scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireRefundOperator(tx, actor);
          const row = await target(tx, id, businessId);
          await append(
            tx,
            row,
            actor,
            "credit",
            "credit",
            {
              documentId,
              message:
                "Linked credit note issued. Review its artifact status in seller documents.",
            },
            at,
          );
          return financialView(row, await events(tx, id));
        },
        { lock: true },
      ),
    pending: async (account: string, mode: string) => {
      const r = await database.execute<FinancialWork>(
        sql`select * from public.financial_pending(${account},${mode})`,
      );
      return r.rows;
    },
    capture: async (receipt: FinancialReceipt) => {
      const r = await database.execute<{ state: string }>(
        sql`select public.financial_capture_receipt(${JSON.stringify(receipt)}::jsonb) as state`,
      );
      if (r.rows[0]?.state === "conflict")
        throw new ApplicationError("CONFLICT");
      return { received: true, duplicate: r.rows[0]?.state === "same" };
    },
    receiptWork: async (account: string, mode: string) => {
      const r = await database.execute<
        FinancialWork & { receipt_id: string; event_name: string }
      >(sql`select * from public.financial_receipt_work(${account},${mode})`);
      return r.rows;
    },
    receiptDone: (work: FinancialWork, receiptId: string, at: Date) =>
      scoped(
        database,
        { userId: "" },
        work.business_id,
        async (tx) => {
          const actor = { userId: "", work };
          await access(tx, actor, work.business_id);
          const row = await target(tx, work.id, work.business_id);
          await append(
            tx,
            row,
            actor,
            `receipt:${receiptId}`,
            "receipt",
            { receiptId },
            at,
          );
        },
        { lock: true },
      ),
    receipts: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        await requireRefundOperator(tx, actor);
        return tx
          .select({
            id: financialReceipt.id,
            receipt: financialReceipt.receipt,
            at: financialReceipt.at,
          })
          .from(financialReceipt)
          .orderBy(asc(financialReceipt.at));
      }),
    financialFeed: (actor: Actor) =>
      scoped(database, actor, "", async (tx) => {
        const [op] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        if (!op?.reconciliation && !op?.tax)
          throw new ApplicationError("FORBIDDEN");
        const result = await tx.execute<{ feed: unknown }>(
          sql`select public.financial_adjustments_feed() as feed`,
        );
        return z
          .array(z.record(z.string(), z.unknown()))
          .parse(result.rows[0]?.feed);
      }),
  };
}
