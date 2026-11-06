import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { discoverySchedule, discoveryDispatch, discoveryRun } from "./schema";
import {
  requireWorkSession,
  settings,
  briefFor,
  checkCurrent,
} from "./discovery-state";
import { ApplicationError } from "../models/application-error";
import { paidAllowance } from "./paid-access";
import type { Actor, Clock } from "../models/business";
import type { DiscoveryWork, WorkIdentity } from "../models/discovery";
import { availableMarkets } from "../discovery/repository";
import { nextDiscoveryDue, sameDiscoveryDay } from "../discovery/timing";
import {
  dispatchSchema,
  type Dispatch,
  type SaveSchedule,
  type ScheduleCommand,
  type ScheduleWork,
  type SavedScheduleView,
  type ScheduleFailure,
} from "../models/discovery-schedules";

export async function persistDispatch(
  tx: Transaction,
  payload: Dispatch,
  at: Date,
) {
  await tx.insert(discoveryDispatch).values({
    id: randomUUID(),
    businessId: payload.work.businessId,
    payload,
    createdAt: at,
  });
}
function scheduledWork(
  row: typeof discoverySchedule.$inferSelect,
): ScheduleWork {
  if (!row.nextDueAt) throw new Error("Schedule has no due time");
  return {
    businessId: row.businessId,
    userId: row.userId,
    sessionId: row.sessionId,
    scheduleId: row.id,
    revision: row.revision,
    dispatchKey: row.dispatchKey,
    dueAt: row.nextDueAt.toISOString(),
  };
}
async function validateSearch(
  tx: Transaction,
  businessId: string,
  input: SaveSchedule,
  at: Date,
) {
  const { profile, policy } = await settings(tx, businessId, at);
  if (!policy) throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
  const paid = await paidAllowance(tx, businessId, "discovery", at);
  if (!paid || input.search.budget > paid.remaining)
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
  if (
    input.search.budget > policy.maxRunBudget ||
    !input.search.markets.every((m) =>
      availableMarkets(profile, policy).includes(m),
    )
  )
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
  return {
    policy,
    brief: briefFor(profile, input.search.markets, input.search.publicOffering),
  };
}

export function createDiscoveryScheduleRepository(
  database: Database,
  clock: Clock,
) {
  return {
    schedules(actor: Actor, businessId: string): Promise<SavedScheduleView[]> {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "sales.work");
        const rows = await tx
          .select()
          .from(discoverySchedule)
          .where(eq(discoverySchedule.businessId, businessId))
          .orderBy(discoverySchedule.updatedAt, discoverySchedule.id);
        const dispatches = await tx
          .select()
          .from(discoveryDispatch)
          .where(eq(discoveryDispatch.businessId, businessId));
        return rows.map((row) => {
          const outgoing = dispatches.filter(
            (d) =>
              d.payload.kind === "schedule" &&
              d.payload.work.scheduleId === row.id &&
              d.payload.work.revision === row.revision &&
              d.payload.work.dueAt === row.nextDueAt?.toISOString(),
          );
          const accepted = outgoing.some((d) => d.state === "enqueued");
          return {
            brief: row.brief,
            id: row.id,
            revision: row.revision,
            name: row.input.name,
            status: row.status,
            timeZone: row.input.timeZone,
            localTime: row.input.localTime,
            weekdays: row.input.weekdays,
            missed: row.input.missed,
            overlap: row.input.overlap,
            dst: row.input.dst,
            allowanceUnit: row.policy.allowanceUnit,
            budget: row.input.search.budget,
            markets: row.input.search.markets,
            publicOffering: row.input.search.publicOffering,
            nextDueAt: row.nextDueAt?.toISOString() ?? null,
            lastRunId: row.lastRunId,
            queueState:
              row.status === "paused"
                ? "paused"
                : accepted
                  ? "enqueued"
                  : "pending",
            failure:
              row.failure ??
              (accepted
                ? null
                : (outgoing.find((d) => d.failure)?.failure ?? null)),
            updatedAt: row.updatedAt.toISOString(),
          };
        });
      });
    },
    saveSchedule(
      actor: WorkIdentity,
      businessId: string,
      input: SaveSchedule,
      at: Date,
    ) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          await requireWorkSession(tx, actor, clock.now());
          const [row] = await tx
            .select()
            .from(discoverySchedule)
            .where(
              and(
                eq(discoverySchedule.id, input.scheduleId),
                eq(discoverySchedule.businessId, businessId),
              ),
            )
            .for("update");
          const command = { action: "save", actor, input };
          if (row && isDeepStrictEqual(row.lastCommand, command))
            return { id: row.id, revision: row.revision };
          if ((row?.revision ?? 0) !== input.expectedRevision)
            throw new ApplicationError("CONFLICT");
          const current = await validateSearch(
            tx,
            businessId,
            input,
            clock.now(),
          );
          const value = {
            id: input.scheduleId,
            businessId,
            userId: actor.userId,
            sessionId: actor.sessionId,
            revision: (row?.revision ?? 0) + 1,
            dispatchKey: randomUUID(),
            input,
            ...current,
            lastCommand: command,
            status: row?.status ?? "active",
            failure: null,
            nextDueAt:
              row?.status === "paused" ? null : nextDiscoveryDue(input, at),
            updatedAt: at,
          };
          const [saved] = row
            ? await tx
                .update(discoverySchedule)
                .set(value)
                .where(eq(discoverySchedule.id, row.id))
                .returning()
            : await tx
                .insert(discoverySchedule)
                .values(value)
                .onConflictDoNothing()
                .returning();
          if (!saved) throw new ApplicationError("CONFLICT");
          if (saved.status === "active")
            await persistDispatch(
              tx,
              { kind: "schedule", work: scheduledWork(saved) },
              at,
            );
          return { id: saved.id, revision: saved.revision };
        },
        { lock: true },
      );
    },
    scheduleCommand(
      actor: WorkIdentity,
      businessId: string,
      input: ScheduleCommand,
      at: Date,
    ) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          await requireWorkSession(tx, actor, clock.now());
          const [row] = await tx
            .select()
            .from(discoverySchedule)
            .where(
              and(
                eq(discoverySchedule.id, input.scheduleId),
                eq(discoverySchedule.businessId, businessId),
              ),
            )
            .for("update");
          if (!row) throw new ApplicationError("NOT_FOUND");
          const command = { actor, input };
          if (isDeepStrictEqual(row.lastCommand, command))
            return { id: row.id, revision: row.revision };
          if (row.revision !== input.expectedRevision)
            throw new ApplicationError("CONFLICT");
          if (input.action === "resume") {
            const current = await validateSearch(
              tx,
              businessId,
              row.input,
              clock.now(),
            );
            if (
              !isDeepStrictEqual(current.policy, row.policy) ||
              !isDeepStrictEqual(current.brief, row.brief)
            )
              throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
          }
          const [saved] = await tx
            .update(discoverySchedule)
            .set({
              status: input.action === "pause" ? "paused" : "active",
              revision: row.revision + 1,
              userId: actor.userId,
              sessionId: actor.sessionId,
              dispatchKey: randomUUID(),
              lastCommand: command,
              nextDueAt:
                input.action === "pause"
                  ? null
                  : nextDiscoveryDue(row.input, at),
              failure: null,
              updatedAt: at,
            })
            .where(eq(discoverySchedule.id, row.id))
            .returning();
          if (saved.status === "active")
            await persistDispatch(
              tx,
              { kind: "schedule", work: scheduledWork(saved) },
              at,
            );
          return { id: saved.id, revision: saved.revision };
        },
        { lock: true },
      );
    },
    due(work: ScheduleWork, at: Date, adapterId: string) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          await requireCapability(tx, work, work.businessId, "profile.manage");
          const [row] = await tx
            .select()
            .from(discoverySchedule)
            .where(
              and(
                eq(discoverySchedule.id, work.scheduleId),
                eq(discoverySchedule.businessId, work.businessId),
              ),
            )
            .for("update");
          if (
            !row ||
            row.userId !== work.userId ||
            row.sessionId !== work.sessionId ||
            row.dispatchKey !== work.dispatchKey ||
            row.revision !== work.revision
          )
            return { outcome: "stale" };
          if (
            row.status !== "active" ||
            row.nextDueAt?.toISOString() !== work.dueAt
          )
            return { outcome: "stale" };
          if (row.nextDueAt > at) return { outcome: "not_due" };
          await requireWorkSession(tx, work, clock.now());
          const current = await validateSearch(
            tx,
            work.businessId,
            row.input,
            clock.now(),
          );
          if (
            current.policy.adapterId !== adapterId ||
            !isDeepStrictEqual(current.policy, row.policy) ||
            !isDeepStrictEqual(current.brief, row.brief)
          )
            throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
          const [overlap] = await tx
            .select({ id: discoveryRun.id })
            .from(discoveryRun)
            .where(
              and(
                eq(discoveryRun.businessId, work.businessId),
                eq(discoveryRun.scheduleId, row.id),
                inArray(discoveryRun.status, ["queued", "running"]),
              ),
            )
            .limit(1);
          // Missed intervals are skipped; a delayed occurrence runs only on its
          // intended Business-local day. Never backfill unbounded historical spend.
          const nextDueAt = nextDiscoveryDue(row.input, at);
          const followingOriginal = nextDiscoveryDue(row.input, row.nextDueAt);
          const missed =
            followingOriginal <= at ||
            !sameDiscoveryDay(row.input.timeZone, row.nextDueAt, at);
          let runId: string | null = null;
          if (!overlap && !missed) {
            runId = randomUUID();
            const executionId = randomUUID();
            await tx.insert(discoveryRun).values({
              id: runId,
              businessId: row.businessId,
              createdBy: row.userId,
              executionUserId: row.userId,
              sessionId: row.sessionId,
              requestKey: randomUUID(),
              executionId,
              brief: row.brief,
              policy: row.policy,
              status: "queued",
              budget: row.input.search.budget,
              scheduleId: row.id,
              scheduleRevision: row.revision,
              scheduledFor: row.nextDueAt,
              createdAt: at,
              updatedAt: at,
            });
            const execution: DiscoveryWork = {
              businessId: row.businessId,
              userId: row.userId,
              sessionId: row.sessionId,
              runId,
              executionKey: executionId,
            };
            await persistDispatch(
              tx,
              { kind: "discovery", work: execution },
              at,
            );
          }
          const [saved] = await tx
            .update(discoverySchedule)
            .set({
              nextDueAt,
              failure: overlap
                ? "overlap_skipped"
                : missed
                  ? "missed_skipped"
                  : null,
              lastRunId: runId ?? row.lastRunId,
              updatedAt: at,
            })
            .where(eq(discoverySchedule.id, row.id))
            .returning();
          await persistDispatch(
            tx,
            { kind: "schedule", work: scheduledWork(saved) },
            at,
          );
          return {
            outcome: overlap
              ? "overlap_skipped"
              : missed
                ? "missed_skipped"
                : "queued",
          };
        },
        { lock: true },
      );
    },
    async failSchedule(
      work: ScheduleWork,
      reason: Exclude<
        ScheduleFailure,
        "queue_unavailable" | "overlap_skipped" | "missed_skipped" | null
      >,
      at: Date,
    ) {
      await database.execute(
        sql`select public.fail_discovery_schedule(${work.scheduleId}::uuid, ${work.businessId}::uuid, ${work.revision}, ${work.dispatchKey}::uuid, ${reason}, ${at.toISOString()}::timestamptz, ${work.dueAt}::timestamptz)`,
      );
    },
    dispatchable(payload: Dispatch) {
      const { work } = payload;
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          await requireCapability(tx, work, work.businessId, "profile.manage");
          if (payload.kind === "schedule") {
            const [row] = await tx
              .select()
              .from(discoverySchedule)
              .where(
                and(
                  eq(discoverySchedule.id, payload.work.scheduleId),
                  eq(discoverySchedule.businessId, work.businessId),
                ),
              );
            if (
              !row ||
              row.revision !== payload.work.revision ||
              row.dispatchKey !== payload.work.dispatchKey ||
              row.userId !== work.userId ||
              row.sessionId !== work.sessionId ||
              row.status !== "active" ||
              row.nextDueAt?.toISOString() !== payload.work.dueAt
            )
              return false;
            await requireWorkSession(tx, work, clock.now());
            const current = await validateSearch(
              tx,
              work.businessId,
              row.input,
              clock.now(),
            );
            if (
              !isDeepStrictEqual(current.brief, row.brief) ||
              !isDeepStrictEqual(current.policy, row.policy)
            )
              throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
          } else {
            const [run] = await tx
              .select()
              .from(discoveryRun)
              .where(
                and(
                  eq(discoveryRun.id, payload.work.runId),
                  eq(discoveryRun.businessId, work.businessId),
                ),
              );
            if (
              !run ||
              run.executionId !== payload.work.executionKey ||
              run.executionUserId !== work.userId ||
              run.sessionId !== work.sessionId ||
              run.status !== "queued"
            )
              return false;
            await requireWorkSession(tx, work, clock.now());
            await checkCurrent(tx, run, clock.now());
            if (run.scheduleId) {
              const [schedule] = await tx
                .select()
                .from(discoverySchedule)
                .where(
                  and(
                    eq(discoverySchedule.id, run.scheduleId),
                    eq(discoverySchedule.businessId, run.businessId),
                  ),
                );
              if (
                !schedule ||
                schedule.status !== "active" ||
                schedule.revision !== run.scheduleRevision
              )
                throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
            }
          }
          return true;
        },
        { lock: true },
      );
    },
    async pendingDispatches(actor?: Actor, businessId?: string) {
      if (actor && businessId)
        return scoped(database, actor, businessId, async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          return tx
            .select({
              id: discoveryDispatch.id,
              payload: discoveryDispatch.payload,
            })
            .from(discoveryDispatch)
            .where(
              and(
                eq(discoveryDispatch.businessId, businessId),
                eq(discoveryDispatch.state, "pending"),
              ),
            )
            .limit(50);
        });
      const result = await database.execute<{ id: string; payload: unknown }>(
        sql`select * from public.pending_discovery_dispatches()`,
      );
      return result.rows.map((row) => ({
        id: row.id,
        payload: dispatchSchema.parse(row.payload),
      }));
    },
    async dispatchResult(id: string, accepted: boolean) {
      await database.execute(
        sql`select public.finish_discovery_dispatch(${id}::uuid, ${accepted})`,
      );
    },
    async checkScheduleForRun(
      tx: Transaction,
      run: typeof discoveryRun.$inferSelect,
    ) {
      if (!run.scheduleId) return;
      const [schedule] = await tx
        .select()
        .from(discoverySchedule)
        .where(
          and(
            eq(discoverySchedule.id, run.scheduleId),
            eq(discoverySchedule.businessId, run.businessId),
          ),
        );
      if (
        !schedule ||
        schedule.status !== "active" ||
        schedule.revision !== run.scheduleRevision
      )
        throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
      await checkCurrent(tx, run, clock.now());
    },
  };
}
