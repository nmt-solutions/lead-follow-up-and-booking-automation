import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { asc, eq, sql } from "drizzle-orm";
import type { TaxRepository } from "../application/tax";
import { evaluateTax } from "../application/tax-calculation";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import type {
  TaxCalculation,
  TaxCalculationInput,
  TaxMode,
} from "../models/tax";
import { requireBillingReviewer } from "./billing-access";
import { readBillingWorkspace } from "./billing-repository";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  taxRuleRevision,
  taxRuleDecision,
  taxCalculation,
  user,
} from "./schema";
import type { Database } from "./runtime";

async function actorName(tx: Transaction, actor: Actor) {
  const [identity] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, actor.userId));
  if (!identity) throw new ApplicationError("UNAUTHENTICATED");
  return identity.name;
}
async function catalog(tx: Transaction) {
  const revisions = await tx
    .select()
    .from(taxRuleRevision)
    .orderBy(asc(taxRuleRevision.version), asc(taxRuleRevision.key));
  const decisions = await tx
    .select()
    .from(taxRuleDecision)
    .orderBy(asc(taxRuleDecision.version), asc(taxRuleDecision.id));
  return {
    revisions: revisions.map((row) => ({ ...row, at: row.at.toISOString() })),
    decisions: decisions.map((row) => ({ ...row, at: row.at.toISOString() })),
  };
}
async function history(tx: Transaction, businessId: string) {
  return (
    await tx
      .select()
      .from(taxCalculation)
      .where(eq(taxCalculation.businessId, businessId))
      .orderBy(asc(taxCalculation.version))
  ).map((row) => row.snapshot);
}
async function lockRules(tx: Transaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('subscription-tax-rules',0))`,
  );
}
async function append(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  input: TaxCalculationInput,
  at: Date,
  mode: TaxMode,
  resolvesId: string | null = null,
): Promise<TaxCalculation> {
  const records = await history(tx, businessId);
  const previous = records.find(
    (record) => record.requestKey === input.requestKey,
  );
  if (previous) {
    if (
      !isDeepStrictEqual(previous.input, input) ||
      previous.resolvesId !== resolvesId ||
      previous.mode !== mode
    )
      throw new ApplicationError("CONFLICT");
    return previous;
  }
  // The shared Business lock also serializes ordinary file mutation commands.
  // Keep this evidence query read-only: tax operators have no file-update policy.
  const billing = await readBillingWorkspace(tx, businessId, at);
  if (
    billing.version !== input.expectedProfileVersion ||
    billing.reviewVersion !== input.expectedReviewVersion
  )
    throw new ApplicationError("CONFLICT");
  // Shared with configuration mutations, so all selected rules/approvals belong to one atomic view.
  await lockRules(tx);
  await tx.execute(sql`select set_config('app.tax_calculation','true',true)`);
  const state = await catalog(tx);
  const relevantKeys = new Set(
    state.revisions
      .filter(
        (row) =>
          row.rule.mode === mode &&
          row.rule.customerCountry ===
            billing.current?.profile.address.country &&
          input.lines.some((line) => line.productCode === row.rule.productCode),
      )
      .map((row) => row.key),
  );
  // Keep the whole relevant key history: a successor can move or remove coverage.
  // Filtering out that successor would silently revive its superseded treatment.
  const revisions = state.revisions.filter(
    (row) => row.rule.mode === mode && relevantKeys.has(row.key),
  );
  const configuration = {
    revisions,
    decisions: state.decisions.filter((row) =>
      revisions.some((revision) => revision.id === row.revisionId),
    ),
  };
  const calculation: TaxCalculation = {
    id: randomUUID(),
    version: records.length + 1,
    businessId,
    requestKey: input.requestKey,
    resolvesId,
    purpose: "tax_preview",
    mode,
    currency: input.currency,
    minorUnit: 2,
    input,
    billing,
    configuration,
    ...evaluateTax(input, billing, configuration, at, mode),
    actorId: actor.userId,
    actorName: await actorName(tx, actor),
    at: at.toISOString(),
    note: input.note,
  };
  await tx.insert(taxCalculation).values({
    id: calculation.id,
    version: calculation.version,
    businessId,
    requestKey: input.requestKey,
    resolvesId,
    actorId: actor.userId,
    at,
    snapshot: calculation,
  });
  return calculation;
}
export function createTaxRepository(database: Database): TaxRepository {
  return {
    rules(actor) {
      return scoped(database, actor, "", async (tx) => {
        await requireBillingReviewer(tx, actor);
        return catalog(tx);
      });
    },
    saveRule(actor, input, at) {
      return scoped(database, actor, "", async (tx) => {
        await requireBillingReviewer(tx, actor);
        await lockRules(tx);
        const state = await catalog(tx),
          latest = state.revisions
            .filter((row) => row.key === input.key)
            .at(-1);
        if ((latest?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        if (
          input.rule.evidence.some(
            (evidence) => new Date(evidence.checkedAt) > at,
          )
        )
          throw new ApplicationError("INVALID_INPUT");
        await tx.insert(taxRuleRevision).values({
          id: randomUUID(),
          key: input.key,
          version: input.expectedVersion + 1,
          rule: input.rule,
          actorId: actor.userId,
          actorName: await actorName(tx, actor),
          at,
          note: input.note,
        });
        return catalog(tx);
      });
    },
    decideRule(actor, input, at) {
      return scoped(database, actor, "", async (tx) => {
        await requireBillingReviewer(tx, actor);
        await lockRules(tx);
        const state = await catalog(tx),
          revision = state.revisions.find((row) => row.id === input.revisionId);
        if (!revision) throw new ApplicationError("NOT_FOUND");
        const latest = state.decisions
          .filter((row) => row.revisionId === input.revisionId)
          .at(-1);
        if ((latest?.version ?? 0) !== input.expectedDecisionVersion)
          throw new ApplicationError("CONFLICT");
        await tx.insert(taxRuleDecision).values({
          id: randomUUID(),
          revisionId: input.revisionId,
          version: input.expectedDecisionVersion + 1,
          outcome: input.outcome,
          note: input.note,
          actorId: actor.userId,
          actorName: await actorName(tx, actor),
          at,
        });
        return catalog(tx);
      });
    },
    workspace(actor, businessId, at, mode, operator) {
      return scoped(database, actor, businessId, async (tx) => {
        if (operator) await requireBillingReviewer(tx, actor);
        else await requireCapability(tx, actor, businessId, "billing.read");
        return {
          billing: await readBillingWorkspace(tx, businessId, at),
          mode,
          calculations: await history(tx, businessId),
        };
      });
    },
    calculate(actor, businessId, input, at, mode) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "billing.manage");
          return append(tx, actor, businessId, input, at, mode);
        },
        { lock: true },
      );
    },
    resolve(actor, businessId, input, at, mode) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireBillingReviewer(tx, actor);
          const records = await history(tx, businessId),
            original = records.find((row) => row.id === input.calculationId);
          if (!original) throw new ApplicationError("NOT_FOUND");
          if (original.status !== "review_required" || original.mode !== mode)
            throw new ApplicationError("CONFLICT");
          const successor = records.find(
            (row) => row.resolvesId === original.id,
          );
          if (successor && successor.requestKey !== input.requestKey)
            throw new ApplicationError("CONFLICT");
          return append(
            tx,
            actor,
            businessId,
            {
              ...original.input,
              requestKey: input.requestKey,
              expectedProfileVersion: input.expectedProfileVersion,
              expectedReviewVersion: input.expectedReviewVersion,
              note: input.note,
            },
            at,
            mode,
            original.id,
          );
        },
        { lock: true },
      );
    },
    queue(actor) {
      return scoped(database, actor, "", async (tx) => {
        await requireBillingReviewer(tx, actor);
        const records = (
          await tx
            .select()
            .from(taxCalculation)
            .orderBy(asc(taxCalculation.at), asc(taxCalculation.id))
        ).map((row) => row.snapshot);
        const resolved = new Set(records.map((row) => row.resolvesId));
        return records
          .filter(
            (row) => row.status === "review_required" && !resolved.has(row.id),
          )
          .map((calculation) => ({
            businessId: calculation.businessId,
            calculation,
          }));
      });
    },
  };
}
