import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sha256SortedJsonV1 } from "../tax-periods/digest";
import { isDeepStrictEqual } from "node:util";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./runtime";
import { scoped, type Transaction } from "./scope";
import type { Actor, Clock } from "../models/business";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import { costSourceSchema } from "../models/costs";
import { validFilingEvidence } from "../tax-filings/evidence";
import type { LiabilityReport } from "../models/tax-periods";
import type {
  FilingExportInput,
  FilingExport,
  SaveFilingPolicy,
  DecideFilingPolicy,
  FilingPolicy,
  PrepareFiling,
  FilingAction,
  FilingIntent,
  StoreFilingEvidence,
  FilingEvidence,
  RemittanceReconciliation,
  FilingExpense,
} from "../models/tax-filings";
import { readTaxReport } from "./tax-period-repository";
import {
  taxFilingExport as exports,
  taxFilingPolicy as policies,
  taxFilingPolicyDecision as decisions,
  taxFilingIntent as intents,
  taxFilingEvent as events,
  taxObligationRevision as obligations,
  user,
  taxFilingEvidence as evidence,
  taxFilingAccess as accesses,
  taxRemittanceAllocation as allocations,
  taxRemittanceReview as reviews,
  session,
  platformOperator,
  costRecord,
  taxLiabilityReport,
  taxReportAction,
} from "./schema";

async function access(tx: Transaction) {
  const r = await tx.execute<{ allowed: boolean }>(
    sql`select public.tax_reporting_operator() as allowed`,
  );
  if (!r.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
}
function publicExport(row: typeof exports.$inferSelect): FilingExport {
  return {
    id: row.id,
    report: row.report,
    format: "tax_accounting_filing_v1",
    filed: false,
    paid: false,
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.at.toISOString(),
    note: row.note,
  };
}
function attributed(row: {
  actorId: string;
  actorName: string;
  at: Date;
  note: string;
}) {
  return {
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.at.toISOString(),
    note: row.note,
  };
}
function policyView(row: typeof policies.$inferSelect): FilingPolicy {
  return {
    id: row.id,
    obligationId: row.obligationId,
    version: row.version,
    definition: row.definition,
    ...attributed(row),
  };
}
function decisionView(row: typeof decisions.$inferSelect) {
  return {
    id: row.id,
    policyId: row.policyId,
    version: row.version,
    outcome: row.outcome,
    ...attributed(row),
  };
}
function retry<T extends { actorId: string; input: Record<string, unknown> }>(
  row: T | undefined,
  actor: Actor,
  input: Record<string, unknown>,
) {
  if (
    row &&
    (row.actorId !== actor.userId || !isDeepStrictEqual(row.input, input))
  )
    throw new ApplicationError("CONFLICT");
  return row;
}
async function people(tx: Transaction) {
  const r = await tx.execute<{ people: unknown }>(
    sql`select public.tax_reporting_people() as people`,
  );
  return z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(r.rows[0]?.people);
}
async function attribution(
  tx: Transaction,
  actor: Actor,
  at: Date,
  note: string,
) {
  const person = (await people(tx)).find((p) => p.id === actor.userId);
  if (!person) throw new ApplicationError("FORBIDDEN");
  return { actorId: actor.userId, actorName: person.name, at, note };
}
async function obligation(tx: Transaction, id: string) {
  const [o] = await tx.select().from(obligations).where(eq(obligations.id, id));
  if (!o) throw new ApplicationError("NOT_FOUND");
  const [latest] = await tx
    .select()
    .from(obligations)
    .where(eq(obligations.key, o.key))
    .orderBy(sql`${obligations.version} desc`)
    .limit(1);
  if (latest.id !== o.id) throw new ApplicationError("CONFLICT");
  return o;
}
async function reviewer(tx: Transaction, actor: Actor, obligationId: string) {
  const o = await obligation(tx, obligationId);
  if (
    !o.definition.reviewerIds.includes(actor.userId) ||
    !(await people(tx)).some((p) => p.id === actor.userId)
  )
    throw new ApplicationError("FORBIDDEN");
  return o;
}
async function factualReviewer(tx: Transaction, actor: Actor, key: string) {
  const [o] = await tx
    .select()
    .from(obligations)
    .where(eq(obligations.key, key))
    .orderBy(sql`${obligations.version} desc`)
    .limit(1);
  if (!o) throw new ApplicationError("NOT_FOUND");
  return reviewer(tx, actor, o.id);
}
function evidenceView(row: typeof evidence.$inferSelect): FilingEvidence {
  return {
    id: row.id,
    reportId: row.reportId,
    target: row.target,
    ...row.metadata,
    ...attributed(row),
  };
}
async function approvedReport(tx: Transaction, input: FilingExportInput) {
  const report = await readTaxReport(tx, input.reportId);
  checkApprovedIdentity(report, input);
  const approval = report.actions.filter((a) => a.kind === "approve").at(-1)!;
  if (
    !approval.actorId ||
    !report.snapshot.obligation.definition.reviewerIds.includes(
      approval.actorId,
    ) ||
    !(await people(tx)).some((p) => p.id === approval.actorId)
  )
    throw new ApplicationError("FORBIDDEN");
  return report;
}
async function currentPolicy(tx: Transaction, id: string, at: Date) {
  const [row] = await tx.select().from(policies).where(eq(policies.id, id));
  if (!row) throw new ApplicationError("NOT_FOUND");
  const [latest] = await tx
    .select()
    .from(policies)
    .where(eq(policies.obligationId, row.obligationId))
    .orderBy(sql`${policies.version} desc`)
    .limit(1);
  const [decision] = await tx
    .select()
    .from(decisions)
    .where(eq(decisions.policyId, id))
    .orderBy(sql`${decisions.version} desc`)
    .limit(1);
  const o = await obligation(tx, row.obligationId);
  if (
    latest.id !== row.id ||
    decision?.outcome !== "approved" ||
    new Date(row.definition.effectiveFrom) > at ||
    (row.definition.effectiveUntil &&
      new Date(row.definition.effectiveUntil) <= at)
  )
    throw new ApplicationError("SETUP_REQUIRED");
  await reviewer(tx, { userId: decision.actorId }, o.id);
  return { policy: row, decision, obligation: o };
}
function unresolved(
  history: { id: string; kind: string; detail: Record<string, unknown> }[],
) {
  return history
    .filter(
      (e) =>
        (e.kind === "raise_issue" ||
          (e.kind === "acknowledge" &&
            (e.detail.matches === false || e.detail.contradiction === true))) &&
        !history.some(
          (r) => r.kind === "resolve_issue" && r.detail.issueId === e.id,
        ),
    )
    .map((e) => e.id);
}
async function originalEffectObserved(tx: Transaction, intentId: string) {
  const history = await tx
    .select()
    .from(events)
    .where(eq(events.intentId, intentId));
  return history.some(
    (e) =>
      e.kind === "confirm" ||
      (e.kind === "acknowledge" &&
        e.detail.matches === true &&
        ["filed", "settled"].includes(String(e.detail.result))),
  );
}
async function filingBasis(
  tx: Transaction,
  target: { obligationKey: string; start: string; end: string },
  excludeId: string | null,
) {
  const all = await tx.select().from(intents);
  const relevant = new Set(
    all
      .filter(
        (i) =>
          i.id !== excludeId &&
          i.target.obligationKey === target.obligationKey &&
          i.target.start === target.start &&
          i.target.end === target.end,
      )
      .map((i) => i.id),
  );
  const facts = (await tx.select().from(events).orderBy(asc(events.id))).filter(
    (e) =>
      relevant.has(e.intentId) &&
      [
        "acknowledge",
        "confirm",
        "raise_issue",
        "resolve_issue",
        "supersede",
      ].includes(e.kind),
  );
  const paid = (
    await tx.select().from(allocations).orderBy(asc(allocations.id))
  ).filter((a) => relevant.has(a.intentId));
  const paidIds = new Set(paid.map((a) => a.id));
  const rs = (await tx.select().from(reviews).orderBy(asc(reviews.id))).filter(
    (r) => paidIds.has(r.allocationId),
  );
  return {
    digest: sha256SortedJsonV1({ facts, paid, reviews: rs }),
    hasRequiredIssues: [...relevant].some(
      (id) => unresolved(facts.filter((e) => e.intentId === id)).length > 0,
    ),
  };
}
async function invalidateProcedureReports(
  tx: Transaction,
  actor: Actor,
  obligationId: string,
  sourceId: string,
  sourceTable: string,
  at: Date,
) {
  for (const report of await tx.select().from(taxLiabilityReport)) {
    if (report.snapshot.obligation.id !== obligationId) continue;
    const history = await tx
      .select()
      .from(taxReportAction)
      .where(eq(taxReportAction.reportId, report.id))
      .orderBy(asc(taxReportAction.version));
    if (history.some((a) => a.kind === "invalidated")) continue;
    await tx.insert(taxReportAction).values({
      id: randomUUID(),
      reportId: report.id,
      version: (history.at(-1)?.version ?? 0) + 1,
      kind: "invalidated",
      detail: { issueId: sourceId, evidence: [sourceTable] },
      requestKey: randomUUID(),
      input: { sourceTable, sourceId },
      ...(await attribution(
        tx,
        actor,
        at,
        "Filing procedure changed; prepare and review an explicit successor report",
      )),
    });
  }
}
async function intentView(
  tx: Transaction,
  row: typeof intents.$inferSelect,
  at: Date,
): Promise<FilingIntent> {
  const history = await tx
    .select()
    .from(events)
    .where(eq(events.intentId, row.id))
    .orderBy(asc(events.version));
  const last = history.at(-1);
  const confirmed = history.some((e) => e.kind === "confirm");
  const unresolvedIssueIds = unresolved(history),
    basis = await filingBasis(tx, row.target, row.id);
  const approval = history.filter((e) => e.kind === "approve").at(-1),
    attempt = history.filter((e) => e.kind === "attempt").at(-1),
    matchingAck = history
      .filter((e) => e.kind === "acknowledge" && e.detail.matches)
      .at(-1),
    superseded = history.some((e) => e.kind === "supersede"),
    lastReview = history
      .filter((e) => e.kind === "raise_issue" || e.kind === "resolve_issue")
      .at(-1);
  let authorizationCurrent = false;
  try {
    await approvedReport(tx, {
      ...row.target,
      requestKey: row.requestKey,
      note: row.note,
    });
    const current = await currentPolicy(tx, row.policyId, at);
    authorizationCurrent = current.decision.id === row.policyDecisionId;
    if (
      row.supersedesId &&
      (await originalEffectObserved(tx, row.supersedesId))
    )
      authorizationCurrent = false;
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
  }
  const reviewRequired =
    unresolvedIssueIds.length > 0 ||
    basis.hasRequiredIssues ||
    !authorizationCurrent ||
    (!confirmed &&
      !superseded &&
      (approval?.detail.basisDigest ?? row.basisDigest) !== basis.digest);
  const status = confirmed
    ? "confirmed"
    : superseded
      ? "superseded"
      : unresolvedIssueIds.length
        ? last?.kind === "acknowledge" && !last.detail.matches
          ? "unmatched_evidence"
          : "review_required"
        : matchingAck
          ? "acknowledged"
          : attempt
            ? String(attempt.detail.outcome)
            : approval && (!lastReview || approval.version > lastReview.version)
              ? "approved"
              : "awaiting_approval";
  return {
    id: row.id,
    kind: row.kind,
    target: row.target,
    report: row.report,
    policy: row.policy,
    policyDecisionId: row.policyDecisionId,
    amountMinor: row.amountMinor,
    amendmentOf: row.amendmentOf,
    supersedesId: row.supersedesId,
    ...attributed(row),
    version: history.length,
    status,
    filed: confirmed && row.kind === "submission",
    paid: confirmed && row.kind === "remittance",
    verification: "operator_evidence_review",
    unresolvedIssueIds,
    basisDigest: row.basisDigest,
    currentBasisDigest: basis.digest,
    reviewRequired,
    authorizationCurrent,
    events: history.map((e) => ({
      id: e.id,
      intentId: e.intentId,
      version: e.version,
      kind: e.kind,
      detail: e.detail,
      ...attributed(e),
    })),
  };
}
export function checkApprovedIdentity(
  report: LiabilityReport,
  input: FilingExportInput,
) {
  if (
    !report.current ||
    report.status !== "approved" ||
    report.id !== input.reportId ||
    report.periodId !== input.periodId ||
    report.revision !== input.revision ||
    report.digest !== input.digest ||
    report.actions.filter((a) => a.kind === "approve").at(-1)?.id !==
      input.approvalId
  )
    throw new ApplicationError("CONFLICT");
}
export function createTaxFilingRepository(database: Database, clock: Clock) {
  async function currentSession(tx: Transaction, actor: Actor) {
    if (!("sessionId" in actor) || typeof actor.sessionId !== "string")
      throw new ApplicationError("UNAUTHENTICATED");
    const [s] = await tx
      .select()
      .from(session)
      .where(eq(session.id, actor.sessionId));
    if (!s || s.userId !== actor.userId || s.expiresAt <= clock.now())
      throw new ApplicationError("UNAUTHENTICATED");
    if (!(await hasMfa(tx, s.token, clock.now(), operatorMfaLifetime)))
      throw new ApplicationError("MFA_REQUIRED");
    const checkTime = () => {
      const now = clock.now();
      if (s.expiresAt <= now) throw new ApplicationError("UNAUTHENTICATED");
      const age = s.mfaVerifiedAt
        ? now.getTime() - s.mfaVerifiedAt.getTime()
        : -1;
      if (age < 0 || age >= operatorMfaLifetime)
        throw new ApplicationError("MFA_REQUIRED");
    };
    checkTime();
    return checkTime;
  }
  async function locked<T>(
    actor: Actor,
    operation: (tx: Transaction) => Promise<T>,
    afterAuthorization?: (tx: Transaction, result: T) => Promise<T>,
  ) {
    // Authentication rechecks use this same transaction connection, including after lock waits.
    // A callback using the pool here could deadlock concurrent callers with a bounded pool.
    return scoped(database, actor, "", async (tx) => {
      await access(tx);
      await currentSession(tx, actor);
      if ("sessionId" in actor && typeof actor.sessionId === "string")
        await tx.execute(
          sql`select set_config('app.tax_session_id',${actor.sessionId},true),set_config('app.tax_at',${clock.now().toISOString()},true)`,
        );
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('tax-reporting',0))`,
      );
      await access(tx);
      await currentSession(tx, actor);
      await tx.execute(
        sql`select set_config('app.tax_at',${clock.now().toISOString()},true)`,
      );
      let result = await operation(tx);
      const checkTime = await currentSession(tx, actor);
      await access(tx);
      if (afterAuthorization) {
        await tx.execute(
          sql`select set_config('app.tax_at',${clock.now().toISOString()},true)`,
        );
        result = await afterAuthorization(tx, result);
      }
      // No authorization query follows the final protected read; expiry is checked again without another wait.
      checkTime();
      return result;
    });
  }
  async function originalBytes(
    tx: Transaction,
    grant: { id: string; hash: string },
  ) {
    const result = await tx.execute<{ body: string | null }>(
      sql`select public.tax_filing_artifact_read(${grant.id}::uuid,${grant.hash}) as body`,
    );
    if (!result.rows[0]?.body) throw new ApplicationError("FORBIDDEN");
    return Buffer.from(result.rows[0].body, "base64");
  }
  return {
    recordExpense: (actor: Actor, input: FilingExpense) =>
      locked(actor, async (tx) => {
        async function costsAllowed() {
          const [op] = await tx
            .select({ costs: platformOperator.costs })
            .from(platformOperator)
            .where(eq(platformOperator.userId, actor.userId));
          if (!op?.costs) throw new ApplicationError("FORBIDDEN");
        }
        await costsAllowed();
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        await costsAllowed();
        const [artifact] = await tx
          .select()
          .from(evidence)
          .where(eq(evidence.id, input.evidenceId));
        if (
          !artifact ||
          artifact.metadata.kind !== "supporting" ||
          BigInt(artifact.metadata.amountMinor) <= 0n
        )
          throw new ApplicationError("INVALID_INPUT");
        if (
          !artifact.target ||
          !["INR", "USD"].includes(artifact.target.currency)
        )
          throw new ApplicationError("SETUP_REQUIRED");
        const sourceId = `evidence:tax_filing:${artifact.id}`,
          fingerprint = sha256SortedJsonV1({ actorId: actor.userId, input });
        const [prior] = await tx
          .select()
          .from(costRecord)
          .where(eq(costRecord.sourceId, sourceId))
          .orderBy(asc(costRecord.version))
          .limit(1);
        if (prior) {
          if (
            prior.actorId !== actor.userId ||
            prior.source.details.requestFingerprint !== fingerprint
          )
            throw new ApplicationError("CONFLICT");
          return { sourceId, recordId: prior.id };
        }
        const source = costSourceSchema.parse({
          month: new Date(artifact.metadata.occurredAt)
            .toISOString()
            .slice(0, 7),
          provider: "tax_administration",
          category: "billing_tax",
          kind: "consumption",
          funding: input.funding,
          amount: {
            currency: artifact.target.currency,
            micros: (BigInt(artifact.metadata.amountMinor) * 10000n).toString(),
          },
          quantity: input.quantity,
          unit: input.unit,
          businessId: null,
          runId: null,
          allocation: `tax filing evidence ${artifact.id}`,
          evidence: `${artifact.metadata.reference}; SHA256 ${artifact.metadata.sha256}`,
          observedAt: artifact.metadata.occurredAt,
          freshUntil: artifact.metadata.occurredAt,
          plan: null,
          status: "recorded",
          details: {
            filingEvidenceId: artifact.id,
            filingEvidenceSha256: artifact.metadata.sha256,
            requestFingerprint: fingerprint,
            verification: "operator_entered_actual_expense",
          },
        });
        const recordId = randomUUID();
        await tx.insert(costRecord).values({
          id: recordId,
          sourceId,
          version: 1,
          month: source.month,
          origin: "operator",
          source,
          reason: input.note,
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
          retainUntil: sql`statement_timestamp()+make_interval(secs=>${input.retentionSeconds})`,
        });
        await costsAllowed();
        return { sourceId, recordId };
      }),
    authorize: (actor: Actor) => locked(actor, async () => {}),
    exportReport: (actor: Actor, input: FilingExportInput, at: Date) =>
      locked(actor, async (tx) => {
        const report = await approvedReport(tx, input);
        const [old] = await tx
          .select()
          .from(exports)
          .where(eq(exports.requestKey, input.requestKey));
        if (old) {
          if (
            old.actorId !== actor.userId ||
            !isDeepStrictEqual(old.input, input)
          )
            throw new ApplicationError("CONFLICT");
          return publicExport(old);
        }
        const [identity] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, actor.userId));
        const [saved] = await tx
          .insert(exports)
          .values({
            id: randomUUID(),
            reportId: report.id,
            report,
            input,
            requestKey: input.requestKey,
            actorId: actor.userId,
            actorName: identity.name,
            at,
            note: input.note,
          })
          .returning();
        return publicExport(saved);
      }),
    savePolicy: (actor: Actor, input: SaveFilingPolicy, at: Date) =>
      locked(actor, async (tx) => {
        await reviewer(tx, actor, input.obligationId);
        const [old] = await tx
          .select()
          .from(policies)
          .where(eq(policies.requestKey, input.requestKey));
        if (retry(old, actor, input)) return policyView(old);
        const prior = await tx
          .select()
          .from(policies)
          .where(eq(policies.obligationId, input.obligationId))
          .orderBy(asc(policies.version));
        if ((prior.at(-1)?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const [row] = await tx
          .insert(policies)
          .values({
            id: randomUUID(),
            obligationId: input.obligationId,
            version: input.expectedVersion + 1,
            definition: input.definition,
            input,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        if (prior.length)
          await invalidateProcedureReports(
            tx,
            actor,
            input.obligationId,
            row.id,
            "tax_filing_policy",
            at,
          );
        return policyView(row);
      }),
    decidePolicy: (actor: Actor, input: DecideFilingPolicy, at: Date) =>
      locked(actor, async (tx) => {
        const [p] = await tx
          .select()
          .from(policies)
          .where(eq(policies.id, input.policyId));
        if (!p) throw new ApplicationError("NOT_FOUND");
        const o = await reviewer(tx, actor, p.obligationId);
        if (o.definition.distinctReviewer && p.actorId === actor.userId)
          throw new ApplicationError("FORBIDDEN");
        const [old] = await tx
          .select()
          .from(decisions)
          .where(eq(decisions.requestKey, input.requestKey));
        if (retry(old, actor, input)) return decisionView(old);
        const [latest] = await tx
          .select()
          .from(policies)
          .where(eq(policies.obligationId, p.obligationId))
          .orderBy(sql`${policies.version} desc`)
          .limit(1);
        const prior = await tx
          .select()
          .from(decisions)
          .where(eq(decisions.policyId, p.id))
          .orderBy(asc(decisions.version));
        if (
          latest.id !== p.id ||
          (prior.at(-1)?.version ?? 0) !== input.expectedVersion
        )
          throw new ApplicationError("CONFLICT");
        const [saved] = await tx
          .insert(decisions)
          .values({
            id: randomUUID(),
            policyId: p.id,
            version: input.expectedVersion + 1,
            outcome: input.outcome,
            input,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        if (prior.length)
          await invalidateProcedureReports(
            tx,
            actor,
            p.obligationId,
            saved.id,
            "tax_filing_policy_decision",
            at,
          );
        return decisionView(saved);
      }),
    prepare: (actor: Actor, input: PrepareFiling, at: Date) =>
      locked(actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(intents)
          .where(eq(intents.requestKey, input.requestKey));
        if (retry(old, actor, input)) return intentView(tx, old, clock.now());
        const report = await approvedReport(tx, input),
          {
            policy,
            decision,
            obligation: o,
          } = await currentPolicy(tx, input.policyId, clock.now());
        if (
          policy.obligationId !== report.snapshot.obligation.id ||
          (input.kind === "submission" &&
            input.amountMinor !== report.snapshot.totals.taxMinor)
        )
          throw new ApplicationError("CONFLICT");
        if (
          !o.definition.preparerIds.includes(actor.userId) &&
          !o.definition.reviewerIds.includes(actor.userId)
        )
          throw new ApplicationError("FORBIDDEN");
        const previous = await tx
          .select()
          .from(intents)
          .where(eq(intents.kind, input.kind));
        const sameCoverage = previous.filter(
          (i) =>
            i.target.obligationKey === o.key &&
            i.target.start === report.snapshot.period.start &&
            i.target.end === report.snapshot.period.end,
        );
        const confirmedPrior: typeof sameCoverage = [];
        const unlinkedSuperseded: typeof sameCoverage = [];
        for (const prior of sameCoverage) {
          const priorView = await intentView(tx, prior, clock.now());
          if (priorView.status === "confirmed") confirmedPrior.push(prior);
          else if (priorView.status === "superseded") {
            if (await originalEffectObserved(tx, prior.id))
              throw new ApplicationError("CONFLICT");
            if (!previous.some((p) => p.supersedesId === prior.id))
              unlinkedSuperseded.push(prior);
          } else throw new ApplicationError("CONFLICT");
        }
        if (input.supersedesId) {
          if (!unlinkedSuperseded.some((i) => i.id === input.supersedesId))
            throw new ApplicationError("CONFLICT");
        } else if (unlinkedSuperseded.length)
          throw new ApplicationError("CONFLICT");
        if (input.kind === "submission" && confirmedPrior.length) {
          const parent = confirmedPrior.find((i) => i.id === input.amendmentOf);
          if (
            !parent ||
            parent.reportId === report.id ||
            sameCoverage.some((i) => i.amendmentOf === parent.id) ||
            parent.target.registration !==
              o.definition.registration.identifier ||
            parent.target.jurisdiction !== o.definition.jurisdiction
          )
            throw new ApplicationError("CONFLICT");
        } else if (input.amendmentOf)
          throw new ApplicationError("INVALID_INPUT");
        const target = {
          reportId: report.id,
          periodId: report.periodId,
          revision: report.revision,
          digest: report.digest,
          approvalId: input.approvalId,
          obligationId: o.id,
          obligationKey: o.key,
          registration: o.definition.registration.identifier,
          jurisdiction: o.definition.jurisdiction,
          mode: o.definition.mode,
          currency: o.definition.currency,
          authorityAccount: policy.definition.authorityAccount,
          fundingAccount: policy.definition.fundingAccount,
          returnType: policy.definition.returnType,
          start: report.snapshot.period.start,
          end: report.snapshot.period.end,
        };
        const basis = await filingBasis(tx, target, null);
        const [row] = await tx
          .insert(intents)
          .values({
            id: randomUUID(),
            reportId: report.id,
            report,
            policyId: policy.id,
            policy: policyView(policy),
            basisDigest: basis.digest,
            reportApprovalId: input.approvalId,
            policyDecisionId: decision.id,
            kind: input.kind,
            target,
            amountMinor: input.amountMinor,
            amendmentOf: input.amendmentOf,
            supersedesId: input.supersedesId,
            input,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        return intentView(tx, row, clock.now());
      }),
    act: (actor: Actor, input: FilingAction, at: Date) =>
      locked(actor, async (tx) => {
        const [row] = await tx
          .select()
          .from(intents)
          .where(eq(intents.id, input.intentId));
        if (!row) throw new ApplicationError("NOT_FOUND");
        const [old] = await tx
          .select()
          .from(events)
          .where(eq(events.requestKey, input.requestKey));
        if (retry(old, actor, input)) return intentView(tx, row, clock.now());
        const current = await intentView(tx, row, clock.now());
        if (current.version !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        if (
          current.status === "superseded" &&
          ["approve", "attempt", "supersede"].includes(input.kind)
        )
          throw new ApplicationError("CONFLICT");
        const factual = input.kind !== "approve" && input.kind !== "attempt";
        const report = factual
          ? row.report
          : await approvedReport(tx, {
              ...row.target,
              requestKey: input.requestKey,
              note: input.note,
            });
        if (!factual) {
          const { decision } = await currentPolicy(
            tx,
            row.policyId,
            clock.now(),
          );
          if (decision.id !== row.policyDecisionId)
            throw new ApplicationError("CONFLICT");
          if (
            row.supersedesId &&
            (await originalEffectObserved(tx, row.supersedesId))
          )
            throw new ApplicationError("CONFLICT");
        }
        let detail: Record<string, unknown> = input;
        let allocation: typeof evidence.$inferSelect | undefined;
        let confirmationKey: string | null = null;
        if (input.kind === "approve") {
          await reviewer(tx, actor, row.target.obligationId);
          const basis = await filingBasis(tx, row.target, row.id);
          if (
            current.events.some(
              (e) =>
                e.kind === "attempt" ||
                (e.kind === "acknowledge" && e.detail.matches),
            ) ||
            current.unresolvedIssueIds.length ||
            basis.hasRequiredIssues ||
            (input.basisDigest ?? row.basisDigest) !== basis.digest ||
            (current.status !== "awaiting_approval" &&
              !current.reviewRequired) ||
            (report.snapshot.obligation.definition.distinctReviewer &&
              row.actorId === actor.userId)
          )
            throw new ApplicationError("CONFLICT");
          detail = { ...input, basisDigest: basis.digest };
        } else if (input.kind === "attempt") {
          if (
            current.reviewRequired ||
            current.events.some(
              (e) =>
                e.kind === "attempt" ||
                (e.kind === "acknowledge" && e.detail.matches),
            ) ||
            current.status !== "approved" ||
            new Date(input.occurredAt) > at
          )
            throw new ApplicationError("CONFLICT");
          const approval = current.events
            .filter((e) => e.kind === "approve")
            .at(-1);
          if (!approval) throw new ApplicationError("CONFLICT");
          await reviewer(
            tx,
            { userId: approval.actorId },
            row.target.obligationId,
          );
        } else if (input.kind === "acknowledge") {
          const [artifact] = await tx
            .select()
            .from(evidence)
            .where(eq(evidence.id, input.evidenceId));
          if (!artifact) throw new ApplicationError("NOT_FOUND");
          const matches =
            isDeepStrictEqual(row.target, artifact.target) &&
            row.reportId === artifact.reportId &&
            artifact.metadata.kind ===
              (row.kind === "submission"
                ? "authority_acknowledgement"
                : "bank_confirmation") &&
            artifact.metadata.amountMinor === row.amountMinor;
          // Facts are appendable before/after an attempt, after source correction and after session replacement.
          const priorConfirmation = current.events.find(
            (e) => e.kind === "confirm",
          );
          const contradiction = Boolean(
            (priorConfirmation &&
              artifact.metadata.result !==
                (row.kind === "submission" ? "filed" : "settled") &&
              new Date(artifact.metadata.occurredAt) >
                new Date(String(priorConfirmation.detail.occurredAt))) ||
            (current.events.some((e) => e.kind === "supersede") &&
              ["filed", "settled"].includes(artifact.metadata.result)),
          );
          detail = {
            ...input,
            matches,
            contradiction,
            evidenceId: artifact.id,
            result: artifact.metadata.result,
            reference: artifact.metadata.reference,
            occurredAt: artifact.metadata.occurredAt,
            verification: "operator_entered_original",
          };
        } else if (input.kind === "confirm") {
          await factualReviewer(tx, actor, row.target.obligationKey);
          const ack = current.events.find(
            (e) => e.id === input.acknowledgementId && e.kind === "acknowledge",
          );
          if (
            current.unresolvedIssueIds.length ||
            !ack ||
            !ack.detail.matches ||
            current.events.some((e) => e.kind === "confirm")
          )
            throw new ApplicationError("CONFLICT");
          const [artifact] = await tx
            .select()
            .from(evidence)
            .where(eq(evidence.id, String(ack.detail.evidenceId)));
          if (
            !artifact ||
            artifact.actorId === actor.userId ||
            row.actorId === actor.userId
          )
            throw new ApplicationError("FORBIDDEN");
          if (
            artifact.metadata.result !==
            (row.kind === "submission" ? "filed" : "settled")
          )
            throw new ApplicationError("CONFLICT");
          if (!current.events.some((e) => e.kind === "approve"))
            throw new ApplicationError("CONFLICT");
          // An acknowledgement/reference is insufficient: a different reviewer attests to the original scoped evidence.
          detail = {
            ...input,
            evidenceId: artifact.id,
            reference: artifact.metadata.reference,
            sha256: artifact.metadata.sha256,
            occurredAt: artifact.metadata.occurredAt,
            verification: "operator_evidence_review",
          };
          confirmationKey = sha256SortedJsonV1({
            kind: row.kind,
            mode: row.target.mode,
            authorityAccount: row.target.authorityAccount,
            fundingAccount: row.target.fundingAccount,
            reference: artifact.metadata.reference,
          });
          const [existingConfirmation] = await tx
            .select()
            .from(events)
            .where(eq(events.confirmationKey, confirmationKey));
          if (existingConfirmation) throw new ApplicationError("CONFLICT");
          if (row.kind === "remittance") {
            allocation = artifact;
          }
        } else if (input.kind === "supersede") {
          await factualReviewer(tx, actor, row.target.obligationKey);
          const [artifact] = await tx
            .select()
            .from(evidence)
            .where(eq(evidence.id, input.evidenceId));
          if (
            !artifact ||
            artifact.actorId === actor.userId ||
            row.actorId === actor.userId
          )
            throw new ApplicationError("FORBIDDEN");
          if (
            current.events.some((e) => e.kind === "confirm") ||
            current.unresolvedIssueIds.length > 0 ||
            current.events.some(
              (e) =>
                ["attempt", "acknowledge"].includes(e.kind) &&
                new Date(String(e.detail.occurredAt)) >
                  new Date(artifact.metadata.occurredAt),
            ) ||
            !isDeepStrictEqual(artifact.target, row.target) ||
            artifact.reportId !== row.reportId ||
            artifact.metadata.result !== "no_effect" ||
            artifact.metadata.amountMinor !== row.amountMinor ||
            artifact.metadata.kind !==
              (row.kind === "submission"
                ? "authority_acknowledgement"
                : "bank_confirmation")
          )
            throw new ApplicationError("CONFLICT");
          detail = {
            ...input,
            sha256: artifact.metadata.sha256,
            reference: artifact.metadata.reference,
            verification: "operator_evidence_review",
            occurredAt: artifact.metadata.occurredAt,
          };
        } else {
          await factualReviewer(tx, actor, row.target.obligationKey);
          const [artifact] = await tx
            .select()
            .from(evidence)
            .where(eq(evidence.id, input.evidenceId));
          if (!artifact || artifact.reportId !== row.reportId)
            throw new ApplicationError("INVALID_INPUT");
          if (input.kind === "resolve_issue") {
            const issue = current.events.find(
              (e) =>
                e.id === input.issueId &&
                (e.kind === "raise_issue" ||
                  (e.kind === "acknowledge" &&
                    (e.detail.matches === false ||
                      e.detail.contradiction === true))),
            );
            if (
              !issue ||
              current.events.some(
                (e) =>
                  e.kind === "resolve_issue" && e.detail.issueId === issue.id,
              ) ||
              issue.actorId === actor.userId
            )
              throw new ApplicationError("CONFLICT");
          }
        }
        const eventId = randomUUID();
        await tx.insert(events).values({
          id: eventId,
          intentId: row.id,
          version: input.expectedVersion + 1,
          kind: input.kind,
          detail,
          confirmationKey,
          input,
          requestKey: input.requestKey,
          ...(await attribution(tx, actor, at, input.note)),
        });
        if (allocation)
          await tx.insert(allocations).values({
            id: randomUUID(),
            intentId: row.id,
            confirmationId: eventId,
            evidenceId: allocation.id,
            reportId: row.reportId,
            referenceKey: confirmationKey!,
            amountMinor: allocation.metadata.amountMinor,
            currency: row.target.currency,
            input,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          });
        return intentView(tx, row, clock.now());
      }),
    reconcileRemittance: (
      actor: Actor,
      input: RemittanceReconciliation,
      at: Date,
    ) =>
      locked(actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(reviews)
          .where(eq(reviews.requestKey, input.requestKey));
        if (retry(old, actor, input))
          return {
            id: old.id,
            allocationId: old.allocationId,
            reportId: old.reportId,
            policyId: old.policyId,
            policyDecisionId: old.policyDecisionId,
            reportApprovalId: old.reportApprovalId,
            version: old.version,
            ...attributed(old),
          };
        const report = await approvedReport(tx, input),
          { policy, decision } = await currentPolicy(
            tx,
            input.policyId,
            clock.now(),
          );
        await reviewer(tx, actor, report.snapshot.obligation.id);
        const [allocation] = await tx
          .select()
          .from(allocations)
          .where(eq(allocations.id, input.allocationId));
        if (!allocation) throw new ApplicationError("NOT_FOUND");
        const [origin] = await tx
          .select()
          .from(intents)
          .where(eq(intents.id, allocation.intentId));
        const prior = await tx
          .select()
          .from(reviews)
          .where(eq(reviews.allocationId, allocation.id))
          .orderBy(asc(reviews.version));
        if (
          (prior.at(-1)?.version ?? 0) !== input.expectedVersion ||
          (prior.at(-1)?.reportId ?? allocation.reportId) !==
            input.expectedReportId ||
          input.reportId === input.expectedReportId ||
          origin.target.obligationKey !== report.snapshot.obligation.key ||
          origin.target.registration !==
            report.snapshot.obligation.definition.registration.identifier ||
          origin.target.start !== report.snapshot.period.start ||
          origin.target.end !== report.snapshot.period.end ||
          origin.target.mode !== report.snapshot.obligation.definition.mode ||
          origin.target.jurisdiction !==
            report.snapshot.obligation.definition.jurisdiction ||
          allocation.currency !== report.snapshot.currency ||
          policy.obligationId !== report.snapshot.obligation.id ||
          origin.target.authorityAccount !==
            policy.definition.authorityAccount ||
          origin.target.fundingAccount !== policy.definition.fundingAccount
        )
          throw new ApplicationError("CONFLICT");
        const [saved] = await tx
          .insert(reviews)
          .values({
            id: randomUUID(),
            allocationId: allocation.id,
            reportId: report.id,
            version: input.expectedVersion + 1,
            policyId: policy.id,
            policyDecisionId: decision.id,
            reportApprovalId: input.approvalId,
            input,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        return {
          id: saved.id,
          allocationId: saved.allocationId,
          reportId: saved.reportId,
          policyId: saved.policyId,
          policyDecisionId: saved.policyDecisionId,
          reportApprovalId: saved.reportApprovalId,
          version: saved.version,
          ...attributed(saved),
        };
      }),
    storeEvidence: (actor: Actor, input: StoreFilingEvidence, at: Date) =>
      locked(actor, async (tx) => {
        const bytes = Buffer.from(input.bytesBase64, "base64");
        if (
          !bytes.length ||
          bytes.length > 2097152 ||
          !validFilingEvidence(input.contentType, bytes) ||
          bytes.toString("base64") !== input.bytesBase64 ||
          createHash("sha256").update(bytes).digest("hex") !== input.sha256 ||
          new Date(input.occurredAt) > at
        )
          throw new ApplicationError("INVALID_INPUT");
        const original: Record<string, unknown> = { ...input };
        delete original.bytesBase64;
        const [old] = await tx
          .select()
          .from(evidence)
          .where(eq(evidence.requestKey, input.requestKey));
        if (retry(old, actor, original)) return evidenceView(old);
        const report = await readTaxReport(tx, input.reportId);
        const [p] = await tx
          .select()
          .from(policies)
          .where(eq(policies.obligationId, report.snapshot.obligation.id))
          .orderBy(sql`${policies.version} desc`)
          .limit(1);
        if (!p) throw new ApplicationError("SETUP_REQUIRED");
        const [saved] = await tx
          .insert(evidence)
          .values({
            id: randomUUID(),
            reportId: report.id,
            target: input.target,
            metadata: {
              kind: input.kind,
              result: input.result,
              reference: input.reference,
              amountMinor: input.amountMinor,
              occurredAt: input.occurredAt,
              name: input.name,
              contentType: input.contentType,
              sha256: input.sha256,
              size: bytes.length,
              verification: "operator_entered_original",
              retention: p.definition.retention,
            },
            input: original,
            requestKey: input.requestKey,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        const stored = await tx.execute<{ stored: boolean }>(
          sql`select public.tax_filing_artifact_store(${saved.id}::uuid,${input.bytesBase64}) as stored`,
        );
        if (!stored.rows[0]?.stored) throw new ApplicationError("CONFLICT");
        return evidenceView(saved);
      }),
    openEvidence: (actor: Actor, id: string) =>
      locked(actor, async (tx) => {
        const [artifact] = await tx
          .select()
          .from(evidence)
          .where(eq(evidence.id, id));
        if (!artifact) throw new ApplicationError("NOT_FOUND");
        const token = randomBytes(32).toString("hex"),
          hash = createHash("sha256").update(token).digest("hex");
        const [grant] = await tx
          .insert(accesses)
          .values({
            id: randomUUID(),
            evidenceId: id,
            actorId: actor.userId,
            accessHash: hash,
            sessionId:
              "sessionId" in actor && typeof actor.sessionId === "string"
                ? actor.sessionId
                : "",
            at: sql`statement_timestamp()`,
            expiresAt: sql`statement_timestamp()+interval '30 seconds'`,
          })
          .returning();
        return { id: grant.id, hash, evidence: evidenceView(artifact) };
      }),
    readEvidence: (actor: Actor, grant: { id: string; hash: string }) =>
      locked(
        actor,
        (tx) => originalBytes(tx, grant),
        async (tx, prior) => {
          const current = await originalBytes(tx, grant);
          if (!current.equals(prior)) throw new ApplicationError("CONFLICT");
          return current;
        },
      ),
    workspace: (actor: Actor) =>
      locked(actor, async (tx) => {
        const ps = await tx
            .select()
            .from(policies)
            .orderBy(asc(policies.version)),
          ds = await tx
            .select()
            .from(decisions)
            .orderBy(asc(decisions.version)),
          records = await tx.select().from(intents).orderBy(asc(intents.at)),
          es = await tx.select().from(exports).orderBy(asc(exports.at));
        const configured: string[] = [];
        for (const p of ps) {
          try {
            await currentPolicy(tx, p.id, clock.now());
            configured.push(p.obligationId);
          } catch (error) {
            if (!(error instanceof ApplicationError)) throw error;
          }
        }
        const artifacts = await tx
          .select()
          .from(evidence)
          .orderBy(asc(evidence.at));
        const paid = await tx.select().from(allocations);
        const rs = await tx
          .select()
          .from(reviews)
          .orderBy(asc(reviews.version));
        const intentViews: FilingIntent[] = [];
        for (const record of records)
          intentViews.push(await intentView(tx, record, clock.now()));
        return {
          policies: ps.map(policyView),
          policyDecisions: ds.map(decisionView),
          intents: intentViews,
          exports: es.map(publicExport),
          configured,
          evidence: artifacts.map(evidenceView),
          allocationReviews: rs.map((r) => ({
            id: r.id,
            allocationId: r.allocationId,
            reportId: r.reportId,
            policyId: r.policyId,
            policyDecisionId: r.policyDecisionId,
            reportApprovalId: r.reportApprovalId,
            version: r.version,
            ...attributed(r),
          })),
          allocations: paid.map((a) => ({
            id: a.id,
            intentId: a.intentId,
            confirmationId: a.confirmationId,
            evidenceId: a.evidenceId,
            reportId: a.reportId,
            currentReportId:
              rs.filter((r) => r.allocationId === a.id).at(-1)?.reportId ??
              a.reportId,
            amountMinor: a.amountMinor,
            currency: a.currency,
            ...attributed(a),
          })),
        };
      }),
  };
}
