import { eq, asc, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { nativeCost, nativeCostRowSchema } from "../costs/native";
import type { Database } from "./runtime";
import { scoped, type Transaction } from "./scope";
import {
  costRecord,
  costPlanningRevision,
  costScan,
  costBudgetRevision,
  costAlert,
  costNotificationEvent,
  platformOperator,
} from "./schema";
import type {
  recordCostSchema,
  costPlanningSchema,
  costBudgetSchema,
  CostPlanning,
  CostAuthority,
  CostWorkspace,
  CostWork,
  CostAlert,
} from "../models/costs";
import { z } from "zod";
import { formatCostMoney } from "../models/costs";
import type { Actor } from "../models/business";
import { ApplicationError } from "../models/application-error";

function costScoped<T>(
  database: Database,
  actor: CostAuthority,
  operation: (tx: Transaction) => Promise<T>,
) {
  return scoped(database, actor, "", async (tx) => {
    await tx.execute(
      sql`select set_config('app.cost_budget',${actor.work?.budgetId ?? ""},true),set_config('app.cost_capability',${actor.work?.capability ?? ""},true)`,
    );
    return operation(tx);
  });
}
async function authorize(
  tx: Transaction,
  actor: CostAuthority,
  month?: string,
) {
  if (actor.work) {
    const result = await tx.execute(
      sql`select public.cost_worker_authorized(${month ?? actor.work.month}) as allowed`,
    );
    if (result.rows[0]?.allowed !== true)
      throw new ApplicationError("FORBIDDEN");
    return;
  }
  const [grant] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!grant?.costs) throw new ApplicationError("FORBIDDEN");
}
export function createCostRepository(database: Database) {
  return {
    work(): Promise<CostWork[]> {
      return database.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select * from public.operator_cost_work()`,
        );
        return result.rows.map((value) => {
          const row = z
            .object({
              budget_id: z.uuid(),
              capability: z.uuid(),
              user_id: z.string(),
              month: z.string(),
            })
            .parse(value);
          return {
            budgetId: row.budget_id,
            capability: row.capability,
            userId: row.user_id,
            month: row.month,
          };
        });
      });
    },
    setBudget(actor: Actor, input: z.infer<typeof costBudgetSchema>) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        const result = await tx.execute(
          sql`select public.cost_owner_email(${input.ownerId}) as email`,
        );
        if (typeof result.rows[0]?.email !== "string")
          throw new ApplicationError("FORBIDDEN");
        const revisions = await tx
          .select()
          .from(costBudgetRevision)
          .where(eq(costBudgetRevision.month, input.month))
          .orderBy(desc(costBudgetRevision.version));
        const previous = revisions.find((r) => r.category === input.category);
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const { expectedVersion, retentionSeconds, ...config } = input;
        const id = randomUUID();
        await tx.insert(costBudgetRevision).values({
          id,
          month: input.month,
          category: input.category,
          version: expectedVersion + 1,
          configuration: {
            ...config,
            retentionSeconds,
            id,
            version: expectedVersion + 1,
          },
          ownerId: input.ownerId,
          workerKey: randomUUID(),
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
          retainUntil: sql`statement_timestamp()+make_interval(secs=>${retentionSeconds})`,
        });
      });
    },
    evaluate(actor: CostAuthority, state: CostWorkspace) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor, state.month);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        const rows = await tx
          .select()
          .from(costBudgetRevision)
          .where(eq(costBudgetRevision.month, state.month))
          .orderBy(asc(costBudgetRevision.version));
        const current = [...new Map(rows.map((r) => [r.category, r])).values()];
        for (const row of current) {
          if (actor.work && row.id !== actor.work.budgetId) continue;
          const active = await tx.execute(
            sql`select ${row.retainUntil.toISOString()}::timestamptz>statement_timestamp() as active`,
          );
          if (active.rows[0]?.active !== true) continue;
          const budget = row.configuration;
          const target =
            budget.category === "global"
              ? {
                  operatorMicros: state.totals.operatorMicros,
                  forecastMicros: state.forecast.operatorMicros,
                }
              : state.categories[budget.category];
          const recipient = await tx.execute(
            sql`select public.cost_owner_email(${budget.ownerId}) as email`,
          );
          const email = recipient.rows[0]?.email;
          if (typeof email !== "string") continue;
          for (const measure of ["actual", "forecast"] as const) {
            if (measure === "forecast" && !budget.forecastAlerts) continue;
            const value =
              measure === "actual"
                ? target.operatorMicros
                : target.forecastMicros;
            if (value === null) continue;
            for (const threshold of budget.thresholds) {
              if (
                BigInt(value) * 100n <
                BigInt(budget.limitInrMicros) * BigInt(threshold)
              )
                continue;
              const summary = `${state.month} ${budget.category} ${measure} costs reached ${threshold}% of the configured INR planning budget. Known covered cost: ${formatCostMoney(value)}; budget: ${formatCostMoney(budget.limitInrMicros)}. As of ${state.asOf}. ${state.forecast.coverage}. INR conversion is an explicit planning assumption, not settlement or customer FX. This notification does not approve extra spend or cancel customer work.`;
              await tx
                .insert(costAlert)
                .values({
                  id: randomUUID(),
                  month: state.month,
                  category: budget.category,
                  threshold,
                  measure,
                  budgetId: row.id,
                  ownerId: budget.ownerId,
                  valueMicros: value,
                  limitMicros: budget.limitInrMicros,
                  summary,
                  email: budget.email ? email : null,
                  emailState: budget.email ? "pending" : "in_app",
                  at: sql`statement_timestamp()`,
                  retainUntil: row.retainUntil,
                })
                .onConflictDoNothing();
            }
          }
        }
      });
    },
    claim(actor: CostAuthority, id: string) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        const result = await tx.execute(
          sql`select * from public.cost_claim_alert(${id}::uuid)`,
        );
        const row = result.rows[0];
        return row
          ? z
              .object({
                id: z.uuid(),
                lease_key: z.uuid(),
                email: z.email(),
                summary: z.string(),
              })
              .parse(row)
          : null;
      });
    },
    deliverable(actor: CostAuthority, id: string, key: string) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        const result = await tx.execute(
          sql`select public.cost_alert_deliverable(${id}::uuid,${key}::uuid) as allowed`,
        );
        return result.rows[0]?.allowed === true;
      });
    },
    finish(id: string, key: string, receipt: string | null) {
      return database.execute(
        sql`select public.cost_finish_alert(${id}::uuid,${key}::uuid,${receipt})`,
      );
    },
    acknowledge(actor: Actor, id: string, note: string) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        const [alert] = await tx
          .select()
          .from(costAlert)
          .where(eq(costAlert.id, id));
        if (!alert) throw new ApplicationError("NOT_FOUND");
        await tx.insert(costNotificationEvent).values({
          id: randomUUID(),
          alertId: id,
          kind: "acknowledged",
          detail: note,
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
        });
      });
    },
    record(actor: Actor, input: z.infer<typeof recordCostSchema>) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        const attribution = await tx.execute(
          sql`select public.cost_attribution_valid(${input.source.businessId},${input.source.runId}) as valid`,
        );
        if (attribution.rows[0]?.valid !== true)
          throw new ApplicationError("INVALID_INPUT");
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        const all = await tx
          .select()
          .from(costRecord)
          .orderBy(asc(costRecord.version));
        const current = [...new Map(all.map((r) => [r.sourceId, r])).values()];
        const previous = current.find((r) => r.sourceId === input.sourceId);
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        if (
          previous &&
          (previous.month !== input.source.month ||
            previous.source.provider !== input.source.provider ||
            previous.source.businessId !== input.source.businessId ||
            previous.source.kind !== input.source.kind ||
            previous.source.funding !== input.source.funding)
        )
          throw new ApplicationError("INVALID_INPUT");
        if (!input.source.observedAt.startsWith(input.source.month))
          throw new ApplicationError("INVALID_INPUT");
        for (const covered of input.source.coversSourceIds ?? []) {
          const target = current.find((r) => r.sourceId === covered);
          if (
            !target ||
            covered === input.sourceId ||
            covered.startsWith("native:payment:") ||
            !["consumption", "commitment", "customer_paid_meta"].includes(
              input.source.kind,
            ) ||
            target.source.kind === "subscription_allocation" ||
            (covered.startsWith("evidence:") &&
              target.source.kind !== "plan_change") ||
            target.month !== input.source.month ||
            target.source.category !== input.source.category ||
            (input.source.businessId !== null &&
              target.source.businessId !== input.source.businessId) ||
            target.source.provider !== input.source.provider ||
            current.some(
              (r) =>
                r.sourceId !== input.sourceId &&
                r.source.coversSourceIds?.includes(covered),
            )
          )
            throw new ApplicationError("INVALID_INPUT");
        }
        await tx.insert(costRecord).values({
          id: randomUUID(),
          sourceId: input.sourceId,
          version: input.expectedVersion + 1,
          month: input.source.month,
          origin: "operator",
          source: input.source,
          reason: input.reason,
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
          retainUntil: sql`statement_timestamp()+make_interval(secs=>${input.retentionSeconds})`,
        });
      });
    },
    configure(actor: Actor, input: z.infer<typeof costPlanningSchema>) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        const [previous] = await tx
          .select()
          .from(costPlanningRevision)
          .where(eq(costPlanningRevision.month, input.month))
          .orderBy(desc(costPlanningRevision.version))
          .limit(1);
        if ((previous?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const { expectedVersion, retentionSeconds, ...config } = input;
        await tx.insert(costPlanningRevision).values({
          id: randomUUID(),
          month: input.month,
          version: expectedVersion + 1,
          configuration: { ...config, version: expectedVersion + 1 },
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
          retainUntil: sql`statement_timestamp()+make_interval(secs=>${retentionSeconds})`,
        });
      });
    },
    refresh(actor: CostAuthority, month: string, retentionSeconds: number) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor, month);
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operator-costs',0))`,
        );
        const rows = await tx.execute(
          sql`select * from public.operator_cost_native(${month})`,
        );
        for (const value of rows.rows) {
          const row = nativeCostRowSchema.parse(value);
          const source = nativeCost(row, month);
          const [previous] = await tx
            .select()
            .from(costRecord)
            .where(eq(costRecord.sourceId, row.source_id))
            .orderBy(desc(costRecord.version))
            .limit(1);
          if (
            previous &&
            JSON.stringify(previous.source) === JSON.stringify(source)
          )
            continue;
          // jsonb key order is canonicalized by Postgres; use its equality for restart-safe source deduplication.
          if (previous) {
            const same = await tx.execute(
              sql`select ${JSON.stringify(previous.source)}::jsonb = ${JSON.stringify(source)}::jsonb as same`,
            );
            if (same.rows[0]?.same === true) continue;
          }
          await tx.insert(costRecord).values({
            id: randomUUID(),
            sourceId: row.source_id,
            version: (previous?.version ?? 0) + 1,
            month,
            origin: "native",
            source,
            reason: "Normalized application/provider observation",
            actorId: actor.userId,
            at: sql`statement_timestamp()`,
            retainUntil: sql`statement_timestamp()+make_interval(secs=>${retentionSeconds})`,
          });
        }
        await tx.insert(costScan).values({
          id: randomUUID(),
          month,
          sourceCount: rows.rows.length,
          actorId: actor.userId,
          at: sql`statement_timestamp()`,
        });
      });
    },
    records(actor: CostAuthority, month: string) {
      return costScoped(database, actor, async (tx) => {
        await authorize(tx, actor, month);
        const history = (
          await tx
            .select()
            .from(costRecord)
            .where(eq(costRecord.month, month))
            .orderBy(asc(costRecord.version), asc(costRecord.id))
        ).map((row) => ({
          ...row,
          at: row.at.toISOString(),
          retainUntil: row.retainUntil.toISOString(),
        }));
        const planningHistory: CostPlanning[] = (
          await tx
            .select()
            .from(costPlanningRevision)
            .where(eq(costPlanningRevision.month, month))
            .orderBy(asc(costPlanningRevision.version))
        ).map((r) => r.configuration);
        const [scan] = await tx
          .select()
          .from(costScan)
          .where(eq(costScan.month, month))
          .orderBy(desc(costScan.at))
          .limit(1);
        const budgetRows = await tx
          .select({
            configuration: costBudgetRevision.configuration,
            category: costBudgetRevision.category,
            activeUntil: costBudgetRevision.retainUntil,
            active: sql<boolean>`${costBudgetRevision.retainUntil}>statement_timestamp()`,
          })
          .from(costBudgetRevision)
          .where(eq(costBudgetRevision.month, month))
          .orderBy(
            asc(costBudgetRevision.version),
            asc(costBudgetRevision.category),
          );
        const budgets = [
          ...new Map(
            budgetRows.map((r) => [
              r.category,
              {
                ...r.configuration,
                activeUntil: r.activeUntil.toISOString(),
                automationActive: r.active,
              },
            ]),
          ).values(),
        ];
        const events = await tx.select().from(costNotificationEvent);
        const alerts: CostAlert[] = (
          await tx
            .select()
            .from(costAlert)
            .where(eq(costAlert.month, month))
            .orderBy(
              asc(costAlert.at),
              asc(costAlert.category),
              asc(costAlert.threshold),
            )
        ).map((row) => ({
          id: row.id,
          month: row.month,
          category: row.category,
          threshold: row.threshold,
          measure: row.measure,
          budgetId: row.budgetId,
          ownerId: row.ownerId,
          valueMicros: row.valueMicros,
          limitMicros: row.limitMicros,
          summary: row.summary,
          emailState: row.emailState,
          at: row.at.toISOString(),
          acknowledged: events.some(
            (e) => e.alertId === row.id && e.kind === "acknowledged",
          ),
        }));
        return {
          history,
          planningHistory,
          nativeScanAt: scan?.at.toISOString() ?? null,
          budgets,
          alerts,
        };
      });
    },
  };
}
