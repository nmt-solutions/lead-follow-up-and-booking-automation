import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { Temporal } from "@js-temporal/polyfill";
import { asc, eq, sql } from "drizzle-orm";
import type { TaxPeriodRepository } from "../application/tax-periods";
import {
  aggregateTaxLiability,
  taxReportingSourcesSchema,
} from "../application/tax-liability";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import type {
  LiabilityReport,
  ObligationRevision,
  ReportingPeriod,
  ReportIssue,
} from "../models/tax-periods";
import {
  taxObligationRevision as obligations,
  taxObligationDecision as decisions,
  taxReportingPeriod as periods,
  taxLiabilityReport as reports,
  taxReportAction as actions,
  taxPeriodReminder,
  user,
} from "./schema";
import { scoped, type Transaction } from "./scope";
import type { Database } from "./runtime";

async function access(tx: Transaction) {
  const result = await tx.execute<{ allowed: boolean }>(
    sql`select public.tax_reporting_operator() as allowed`,
  );
  if (!result.rows[0]?.allowed) throw new ApplicationError("FORBIDDEN");
}
async function locked<T>(
  database: Database,
  actor: Actor,
  operation: (tx: Transaction) => Promise<T>,
) {
  return scoped(database, actor, "", async (tx) => {
    await access(tx);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('tax-reporting',0))`,
    );
    return operation(tx);
  });
}
async function attribution(
  tx: Transaction,
  actor: Actor,
  at: Date,
  note: string,
) {
  const [identity] = await tx
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, actor.userId));
  if (!identity) throw new ApplicationError("UNAUTHENTICATED");
  return { actorId: actor.userId, actorName: identity.name, at, note };
}
function publicObligation(
  row: typeof obligations.$inferSelect,
): ObligationRevision {
  return {
    id: row.id,
    key: row.key,
    version: row.version,
    definition: row.definition,
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.at.toISOString(),
    note: row.note,
  };
}
function publicDecision(row: typeof decisions.$inferSelect) {
  return {
    id: row.id,
    revisionId: row.revisionId,
    version: row.version,
    outcome: row.outcome,
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.at.toISOString(),
    note: row.note,
  };
}
function retry<
  T extends { actorId: string | null; input: Record<string, unknown> },
>(row: T | undefined, actor: Actor, input: Record<string, unknown>) {
  if (
    row &&
    (row.actorId !== actor.userId || !isDeepStrictEqual(row.input, input))
  )
    throw new ApplicationError("CONFLICT");
  return row;
}
async function configuration(tx: Transaction, id: string) {
  const [original] = await tx
    .select()
    .from(obligations)
    .where(eq(obligations.id, id));
  if (!original) throw new ApplicationError("NOT_FOUND");
  const revisions = await tx
    .select()
    .from(obligations)
    .where(eq(obligations.key, original.key))
    .orderBy(asc(obligations.version));
  const current = revisions.at(-1)!;
  const ds = await tx
    .select()
    .from(decisions)
    .where(eq(decisions.revisionId, current.id))
    .orderBy(asc(decisions.version));
  return { current, decision: ds.at(-1), fingerprint: hash([revisions, ds]) };
}
function hash(value: unknown) {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(sorted(normalized)))
    .digest("hex");
}
function effective(
  config: ObligationRevision["definition"],
  start: string,
  end: string,
) {
  return (
    new Date(config.effectiveFrom) <= new Date(start) &&
    (!config.effectiveUntil ||
      new Date(config.effectiveUntil) >= new Date(end)) &&
    new Date(config.registration.effectiveFrom) <= new Date(start) &&
    (!config.registration.effectiveUntil ||
      new Date(config.registration.effectiveUntil) >= new Date(end))
  );
}
async function operators(tx: Transaction) {
  const result = await tx.execute<{ people: unknown }>(
    sql`select public.tax_reporting_people() as people`,
  );
  return z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(result.rows[0]?.people);
}
async function source(tx: Transaction, periodId: string) {
  const result = await tx.execute<{ population: unknown }>(
    sql`select public.tax_reporting_sources(${periodId}::uuid) as population`,
  );
  const parsed = taxReportingSourcesSchema.safeParse(
    result.rows[0]?.population,
  );
  if (!parsed.success) throw new ApplicationError("SETUP_REQUIRED");
  return parsed.data;
}
async function view(
  tx: Transaction,
  row: typeof reports.$inferSelect,
): Promise<LiabilityReport> {
  const records = await tx
    .select()
    .from(actions)
    .where(eq(actions.reportId, row.id))
    .orderBy(asc(actions.version));
  const [latest] = await tx
    .select({ revision: reports.revision })
    .from(reports)
    .where(eq(reports.periodId, row.periodId))
    .orderBy(sql`${reports.revision} desc`)
    .limit(1);
  const config = await configuration(tx, row.snapshot.obligation.id),
    population = await source(tx, row.periodId);
  const current =
    !records.some((a) => a.kind === "invalidated") &&
    config.fingerprint === row.snapshot.configurationFingerprint &&
    population.fingerprint === row.snapshot.sourceFingerprint &&
    config.decision?.outcome === "approved";
  const unresolved: ReportIssue[] = [...row.snapshot.issues];
  for (const action of records) {
    if (action.kind === "raise_issue")
      unresolved.push({
        id: action.id,
        code: "reviewer_issue",
        sourceId: action.detail.issueId,
        required: true,
        resolvable: true,
      });
    if (action.kind === "resolve_issue") {
      const index = unresolved.findIndex((i) => i.id === action.detail.issueId);
      if (index >= 0) unresolved.splice(index, 1);
    }
  }
  if (!current)
    unresolved.push({
      id: "sources_or_configuration_changed",
      code: "sources_or_configuration_changed",
      sourceId: null,
      required: true,
      resolvable: false,
    });
  const lastApproval =
    records.filter((a) => a.kind === "approve").at(-1)?.version ?? 0;
  const lastReviewChange =
    records
      .filter((a) =>
        ["review", "raise_issue", "resolve_issue"].includes(a.kind),
      )
      .at(-1)?.version ?? 0;
  return {
    id: row.id,
    periodId: row.periodId,
    revision: row.revision,
    digest: row.digest,
    digestAlgorithm: "sha256_sorted_json_v1",
    snapshot: row.snapshot,
    actorId: row.actorId,
    actorName: row.actorName,
    at: row.at.toISOString(),
    note: row.note,
    current,
    filed: false,
    paid: false,
    status:
      latest.revision !== row.revision
        ? "superseded"
        : !current || unresolved.length
          ? "review_required"
          : lastApproval > lastReviewChange
            ? "approved"
            : records.length
              ? "in_review"
              : "prepared",
    actions: records.map((a) => ({
      id: a.id,
      version: a.version,
      kind: a.kind,
      detail: a.detail,
      actorId: a.actorId,
      actorName: a.actorName,
      at: a.at.toISOString(),
      note: a.note,
    })),
    unresolved,
  };
}
export function createTaxPeriodRepository(
  database: Database,
): TaxPeriodRepository {
  return {
    authorize: (actor) => locked(database, actor, async () => {}),
    evaluateReminders: (actor, at) =>
      locked(database, actor, async (tx) => {
        const result = await tx.execute<{ created: number }>(
          sql`select public.tax_reporting_due(${at.toISOString()}::timestamptz) as created`,
        );
        return { created: result.rows[0].created };
      }),
    report: (actor, id) =>
      locked(database, actor, async (tx) => {
        const [row] = await tx.select().from(reports).where(eq(reports.id, id));
        if (!row) throw new ApplicationError("NOT_FOUND");
        return view(tx, row);
      }),
    saveObligation: (actor, input, at) =>
      locked(database, actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(obligations)
          .where(eq(obligations.requestKey, input.requestKey));
        if (retry(old, actor, input)) return publicObligation(old);
        const rows = await tx
          .select()
          .from(obligations)
          .where(eq(obligations.key, input.key))
          .orderBy(asc(obligations.version));
        const previous = rows.at(-1);
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const people = await operators(tx);
        if (
          [
            ...input.definition.preparerIds,
            ...input.definition.reviewerIds,
          ].some((id) => !people.some((p) => p.id === id))
        )
          throw new ApplicationError("INVALID_INPUT");
        if (
          previous &&
          ["mode", "jurisdiction", "timeZone", "currency"].some(
            (k) =>
              Reflect.get(previous.definition, k) !==
              Reflect.get(input.definition, k),
          )
        )
          throw new ApplicationError("INVALID_INPUT");
        const [row] = await tx
          .insert(obligations)
          .values({
            id: randomUUID(),
            key: input.key,
            version: input.expectedVersion + 1,
            definition: input.definition,
            requestKey: input.requestKey,
            input,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        return publicObligation(row);
      }),
    decideObligation: (actor, input, at) =>
      locked(database, actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(decisions)
          .where(eq(decisions.requestKey, input.requestKey));
        if (retry(old, actor, input)) return publicDecision(old);
        const config = await configuration(tx, input.revisionId);
        if (
          config.current.id !== input.revisionId ||
          (config.decision?.version ?? 0) !== input.expectedVersion
        )
          throw new ApplicationError("CONFLICT");
        const [row] = await tx
          .insert(decisions)
          .values({
            id: randomUUID(),
            revisionId: input.revisionId,
            version: input.expectedVersion + 1,
            outcome: input.outcome,
            requestKey: input.requestKey,
            input,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        return publicDecision(row);
      }),
    openPeriod: (actor, input, at) =>
      locked(database, actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(periods)
          .where(eq(periods.requestKey, input.requestKey));
        if (retry(old, actor, input)) return old.definition;
        const config = await configuration(tx, input.obligationId);
        if (
          config.current.id !== input.obligationId ||
          config.decision?.outcome !== "approved"
        )
          throw new ApplicationError("SETUP_REQUIRED");
        const timeZone = config.current.definition.timeZone;
        const start = Temporal.PlainDate.from(input.startDate)
          .toZonedDateTime(timeZone)
          .toInstant()
          .toString({ smallestUnit: "millisecond" });
        const end = Temporal.PlainDate.from(input.endDate)
          .toZonedDateTime(timeZone)
          .toInstant()
          .toString({ smallestUnit: "millisecond" });
        if (
          start >= end ||
          Temporal.Instant.from(start)
            .toZonedDateTimeISO(timeZone)
            .toPlainDate()
            .toString() !== input.startDate ||
          Temporal.Instant.from(end)
            .toZonedDateTimeISO(timeZone)
            .toPlainDate()
            .toString() !== input.endDate
        )
          throw new ApplicationError("INVALID_INPUT");
        if (!effective(config.current.definition, start, end))
          throw new ApplicationError("SETUP_REQUIRED");
        const existing = await tx.select().from(periods);
        for (const p of existing) {
          if (p.definition.start >= end || p.definition.end <= start) continue;
          const other = await configuration(tx, p.obligationId),
            a = other.current.definition,
            b = config.current.definition;
          if (
            p.definition.obligationKey === config.current.key ||
            (a.mode === b.mode &&
              a.jurisdiction === b.jurisdiction &&
              a.registration.identifier === b.registration.identifier)
          )
            throw new ApplicationError("CONFLICT");
        }
        const attr = await attribution(tx, actor, at, input.note);
        const period: ReportingPeriod = {
          id: randomUUID(),
          obligationId: input.obligationId,
          obligationKey: config.current.key,
          start,
          end,
          startDate: input.startDate,
          endDate: input.endDate,
          timeZone,
          dueAt: input.dueAt,
          evidence: input.evidence,
          reminders: input.reminders,
          ...attr,
          at: at.toISOString(),
        };
        await tx.insert(periods).values({
          id: period.id,
          obligationId: input.obligationId,
          definition: period,
          requestKey: input.requestKey,
          input,
          ...attr,
        });
        return period;
      }),
    prepare: (actor, input, at) =>
      locked(database, actor, async (tx) => {
        const [old] = await tx
          .select()
          .from(reports)
          .where(eq(reports.requestKey, input.requestKey));
        if (retry(old, actor, input)) return view(tx, old);
        const [period] = await tx
          .select()
          .from(periods)
          .where(eq(periods.id, input.periodId));
        if (!period) throw new ApplicationError("NOT_FOUND");
        const config = await configuration(tx, period.obligationId);
        if (!config.current.definition.preparerIds.includes(actor.userId))
          throw new ApplicationError("FORBIDDEN");
        if (
          config.decision?.outcome !== "approved" ||
          !effective(
            config.current.definition,
            period.definition.start,
            period.definition.end,
          )
        )
          throw new ApplicationError("SETUP_REQUIRED");
        if (
          new Date(input.cutoff) > at ||
          new Date(input.cutoff) < new Date(period.definition.start)
        )
          throw new ApplicationError("INVALID_INPUT");
        const previous = await tx
          .select()
          .from(reports)
          .where(eq(reports.periodId, period.id))
          .orderBy(asc(reports.revision));
        if ((previous.at(-1)?.revision ?? 0) !== input.expectedRevision)
          throw new ApplicationError("CONFLICT");
        const snapshot = aggregateTaxLiability(
          publicObligation(config.current),
          period.definition,
          await source(tx, period.id),
          input.cutoff,
          config.fingerprint,
        );
        const [row] = await tx
          .insert(reports)
          .values({
            id: randomUUID(),
            periodId: period.id,
            revision: input.expectedRevision + 1,
            snapshot,
            digest: hash(snapshot),
            requestKey: input.requestKey,
            input,
            ...(await attribution(tx, actor, at, input.note)),
          })
          .returning();
        return view(tx, row);
      }),
    act: (actor, input, at) =>
      locked(database, actor, async (tx) => {
        const [row] = await tx
          .select()
          .from(reports)
          .where(eq(reports.id, input.reportId));
        if (!row) throw new ApplicationError("NOT_FOUND");
        const config = await configuration(tx, row.snapshot.obligation.id);
        if (!config.current.definition.reviewerIds.includes(actor.userId))
          throw new ApplicationError("FORBIDDEN");
        const [old] = await tx
          .select()
          .from(actions)
          .where(eq(actions.requestKey, input.requestKey));
        if (retry(old, actor, input)) return view(tx, row);
        const report = await view(tx, row);
        if (
          !report.current ||
          report.status === "superseded" ||
          report.actions.length !== input.expectedVersion ||
          (report.status === "approved" && input.kind !== "raise_issue")
        )
          throw new ApplicationError("CONFLICT");
        if (
          input.kind === "approve" &&
          (report.unresolved.length ||
            (config.current.definition.distinctReviewer &&
              row.actorId === actor.userId))
        )
          throw new ApplicationError("FORBIDDEN");
        if (
          input.kind === "resolve_issue" &&
          !report.unresolved.some((i) => i.id === input.issueId && i.resolvable)
        )
          throw new ApplicationError("INVALID_INPUT");
        if (
          input.kind === "raise_issue" &&
          input.issueId !== null &&
          input.issueId !== "period" &&
          !report.snapshot.sources.some((s) => s.id === input.issueId)
        )
          throw new ApplicationError("INVALID_INPUT");
        if (
          input.kind !== "raise_issue" &&
          input.kind !== "resolve_issue" &&
          input.issueId !== null
        )
          throw new ApplicationError("INVALID_INPUT");
        await tx.insert(actions).values({
          id: randomUUID(),
          reportId: row.id,
          version: input.expectedVersion + 1,
          kind: input.kind,
          detail: { issueId: input.issueId, evidence: input.evidence },
          requestKey: input.requestKey,
          input,
          ...(await attribution(tx, actor, at, input.note)),
        });
        return view(tx, row);
      }),
    workspace: (actor, at) =>
      locked(database, actor, async (tx) => {
        const os = await tx
          .select()
          .from(obligations)
          .orderBy(asc(obligations.key), asc(obligations.version));
        const ds = await tx
          .select()
          .from(decisions)
          .orderBy(asc(decisions.version));
        const ps = await tx
          .select()
          .from(periods)
          .orderBy(sql`${periods.definition}->>'dueAt'`);
        const result = [];
        for (const p of ps) {
          const rs = await tx
            .select()
            .from(reports)
            .where(eq(reports.periodId, p.id))
            .orderBy(asc(reports.revision));
          const history = [];
          for (const r of rs) history.push(await view(tx, r));
          const report = history.at(-1) ?? null;
          result.push({
            period: p.definition,
            report,
            reports: history,
            status: report?.status ?? "not_prepared",
            overdue: at > new Date(p.definition.dueAt),
          });
        }
        const reminders = [];
        for (const r of await tx
          .select()
          .from(taxPeriodReminder)
          .orderBy(asc(taxPeriodReminder.stageAt))) {
          const current = await tx.execute<{ current: boolean }>(
            sql`select public.tax_reminder_visible(${r.id}::uuid) as current`,
          );
          reminders.push({
            id: r.id,
            periodId: r.periodId,
            stage: r.stage,
            stageAt: r.stageAt.toISOString(),
            at: r.at.toISOString(),
            source: r.source,
            channel: "in_app" as const,
            status: "available" as const,
            current: current.rows[0].current,
          });
        }
        return {
          obligations: os.map(publicObligation),
          decisions: ds.map(publicDecision),
          periods: result,
          reminders,
          operators: await operators(tx),
          actorId: actor.userId,
        };
      }),
  };
}
