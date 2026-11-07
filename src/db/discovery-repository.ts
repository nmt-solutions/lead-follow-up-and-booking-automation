import {
  createDiscoveryScheduleRepository,
  persistDispatch,
} from "./discovery-schedule-repository";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  discoveryRun,
  discoveryCapacityBinding,
  discoveryDispatch,
  discoverySchedule,
  discoveryProspect,
  discoveryResult,
  discoveryUsage,
  discoveryProspectAlias,
  discoveryObservation,
  discoveryCommand,
} from "./schema";
import { ApplicationError } from "../models/application-error";
import {
  persistedProspectSchema,
  observationOutcomeSchema,
  sourceCheckSchema,
  evidenceUrlSchema,
  searchResultSchema,
  discoveryProviderCostSchema,
  type DiscoveryWork,
  type RunView,
} from "../models/discovery";
import {
  availableMarkets,
  type DiscoveryRepository,
} from "../discovery/repository";
import type { Clock } from "../models/business";
import {
  requireWorkSession,
  briefFor,
  settings,
  checkCurrent,
  checkCurrentScope,
  requireDiscoveryAvailable,
} from "./discovery-state";
import { coverageCounts } from "../discovery/evidence";
import { reservePaidUsage, paidAllowance } from "./paid-access";
import {
  consolidateViews,
  contactIdentities,
  companyIdentity,
  identityKeys,
  type RetainedObservation,
} from "../discovery/consolidation";

export async function observationsFor(
  tx: Transaction,
  businessId: string,
): Promise<RetainedObservation[]> {
  const savedObservations = await tx
    .select({
      observation: discoveryObservation,
      order: discoveryUsage.checkOrder,
    })
    .from(discoveryObservation)
    .innerJoin(
      discoveryUsage,
      and(
        eq(discoveryUsage.id, discoveryObservation.id),
        eq(discoveryUsage.businessId, businessId),
      ),
    )
    .where(eq(discoveryObservation.businessId, businessId));
  const observations = savedObservations.map(({ observation, order }) => ({
    ...observation,
    order: order ?? 0,
  }));
  const represented = new Set(
    observations.map((o) => `${o.runId}:${o.prospectId}`),
  );
  const saved = await tx
    .select()
    .from(discoveryResult)
    .where(eq(discoveryResult.businessId, businessId));
  const results = saved.map((result) => ({
    ...result,
    data: persistedProspectSchema.parse(result.data),
  }));
  return [
    ...observations.map((o) => ({
      id: o.id,
      runId: o.runId,
      prospectId: o.prospectId,
      checkedAt: o.checkedAt.toISOString(),
      outcome: observationOutcomeSchema.parse(o.outcome),
      data: persistedProspectSchema.parse(o.data),
      order: o.order,
    })),
    ...results
      .filter((r) => !represented.has(`${r.runId}:${r.prospectId}`))
      .map((r) => {
        const data = persistedProspectSchema.parse(r.data);
        return {
          id: `legacy:${r.runId}:${r.prospectId}`,
          runId: r.runId,
          prospectId: r.prospectId,
          checkedAt: data.evidence[0].checkedAt,
          outcome: "legacy" as const,
          order: 0,
          data,
        };
      }),
  ];
}

export async function discoveryEvidenceAt(
  tx: Transaction,
  businessId: string,
  at: Date,
) {
  const observations = await observationsFor(tx, businessId);
  const checked = await tx
    .select()
    .from(discoveryUsage)
    .where(
      and(
        eq(discoveryUsage.businessId, businessId),
        eq(discoveryUsage.kind, "review"),
        eq(discoveryUsage.outcome, "succeeded"),
      ),
    );
  const checks = checked.flatMap((u) =>
    u.sourceUrl && u.checkedAt
      ? [
          {
            ...sourceCheckSchema.parse({
              runId: u.runId,
              url: u.sourceUrl,
              checkedAt: u.checkedAt.toISOString(),
            }),
            order: u.checkOrder ?? 0,
          },
        ]
      : [],
  );
  const prospects = consolidateViews(observations, businessId, at, checks);
  return { observations, checks, prospects };
}

async function ownedRun(tx: Transaction, work: DiscoveryWork) {
  await requireCapability(tx, work, work.businessId, "profile.manage");
  const [run] = await tx
    .select()
    .from(discoveryRun)
    .where(
      and(
        eq(discoveryRun.id, work.runId),
        eq(discoveryRun.businessId, work.businessId),
      ),
    )
    .for("update");
  if (
    !run ||
    (run.executionUserId ?? run.createdBy) !== work.userId ||
    run.sessionId !== work.sessionId ||
    run.executionId !== work.executionKey
  )
    throw new ApplicationError("NOT_FOUND");
  return run;
}

export function createDiscoveryRepository(
  database: Database,
  clock: Clock,
): DiscoveryRepository {
  const schedules = createDiscoveryScheduleRepository(database, clock);
  return {
    ...schedules,
    guard(work, at) {
      return scoped(database, work, work.businessId, async (tx) => {
        const run = await ownedRun(tx, work);
        await requireWorkSession(tx, work, at);
        await schedules.checkScheduleForRun(tx, run);
        await checkCurrent(tx, run, clock.now());
        if (run.status !== "running")
          throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
      });
    },
    workspace(actor, businessId) {
      return scoped(database, actor, businessId, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        const { profile, policy } = await settings(tx, businessId, clock.now());
        const markets = availableMarkets(profile, policy);
        const rows = await tx
          .select()
          .from(discoveryRun)
          .where(eq(discoveryRun.businessId, businessId))
          .orderBy(desc(discoveryRun.createdAt), desc(discoveryRun.id))
          .limit(50);
        const outgoing = await tx
          .select()
          .from(discoveryDispatch)
          .where(eq(discoveryDispatch.businessId, businessId));
        const runs: RunView[] = [];
        const {
          observations,
          checks,
          prospects: retained,
        } = await discoveryEvidenceAt(tx, businessId, clock.now());
        for (const row of rows) {
          const usage = await tx
            .select()
            .from(discoveryUsage)
            .where(
              and(
                eq(discoveryUsage.businessId, businessId),
                eq(discoveryUsage.runId, row.id),
              ),
            )
            .orderBy(asc(discoveryUsage.position));
          // Explicit public projection excludes worker capabilities and session IDs.
          const runObservations = observations.filter(
            (o) => o.runId === row.id,
          );
          const prospects = consolidateViews(
            runObservations,
            businessId,
            clock.now(),
            checks.filter((c) => c.runId === row.id),
          );
          const [capacityBinding] = await tx
            .select()
            .from(discoveryCapacityBinding)
            .where(
              and(
                eq(discoveryCapacityBinding.id, row.executionId),
                eq(discoveryCapacityBinding.businessId, businessId),
              ),
            );
          runs.push({
            executionCapacity: capacityBinding
              ? {
                  mode: capacityBinding.route.mode,
                  slots: capacityBinding.route.slots,
                  policyVersion: capacityBinding.route.version,
                }
              : null,
            id: row.id,
            businessId,
            queueState:
              row.status !== "queued"
                ? "inactive"
                : outgoing.some(
                      (d) =>
                        d.payload.kind === "discovery" &&
                        d.payload.work.runId === row.id &&
                        d.payload.work.executionKey === row.executionId &&
                        d.state === "enqueued",
                    )
                  ? "enqueued"
                  : "pending",
            scheduleId: row.scheduleId,
            scheduleRevision: row.scheduleRevision,
            scheduledFor: row.scheduledFor?.toISOString() ?? null,
            brief: row.brief,
            createdBy: row.createdBy,
            status: row.status,
            stopReason: row.stopReason,
            budget: row.budget,
            used: row.used,
            completedSteps: row.completedSteps,
            attempt: row.attempt,
            consumed: usage
              .filter((u) => u.outcome !== "reserved")
              .reduce((n, u) => n + u.units, 0),
            reserved: usage
              .filter((u) => u.outcome === "reserved")
              .reduce((n, u) => n + u.units, 0),
            remaining: row.budget - row.used,
            maxBudget: row.policy.maxRunBudget,
            resumable:
              row.status === "stopped" &&
              usage.every(
                (u) =>
                  u.stepKey !== null &&
                  (u.kind === "review" ||
                    u.outcome !== "succeeded" ||
                    u.sources !== null),
              ),
            audit: (
              await tx
                .select()
                .from(discoveryCommand)
                .where(
                  and(
                    eq(discoveryCommand.businessId, businessId),
                    eq(discoveryCommand.runId, row.id),
                  ),
                )
                .orderBy(asc(discoveryCommand.position))
            ).map((c) => ({
              id: c.id,
              action: c.input.action,
              actorId: c.actorId,
              budgetBefore: c.budgetBefore,
              budgetAfter: c.budgetAfter,
              stopReason: c.stopReason,
              at: c.at.toISOString(),
            })),
            allowanceUnit: row.policy.allowanceUnit,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
            prospects,
            counts: coverageCounts(prospects),
            consolidation: {
              rawResults: usage.some(
                (u) => u.kind === "search" && u.returnedResults === null,
              )
                ? null
                : usage.reduce((n, u) => n + (u.returnedResults ?? 0), 0),
              matchedObservations: runObservations.length,
              created: runObservations.filter((o) => o.outcome === "created")
                .length,
              refreshed: runObservations.filter(
                (o) => o.outcome === "refreshed",
              ).length,
              duplicates: runObservations.filter(
                (o) => o.outcome === "duplicate",
              ).length,
            },
            usage: usage.map(
              ({ id, kind, units, outcome, query, at, returnedResults }) => ({
                id,
                kind,
                units,
                outcome,
                query,
                at: at.toISOString(),
                returnedResults,
              }),
            ),
          });
        }
        const stop = await tx.execute<{ stopped: boolean }>(
          sql`select public.business_data_stopped(${businessId}::uuid) stopped`,
        );
        const stopped = stop.rows[0]?.stopped === true;
        await requireCapability(tx, actor, businessId, "sales.work");
        return {
          schedules: [],
          canRun: role !== "salesperson" && !stopped,
          setup: [
            ...(stopped
              ? [
                  "Business connections are stopped. Allow new setup from Data and offboarding before approving new discovery.",
                ]
              : []),
            ...(!policy
              ? [
                  "Active paid discovery scope, matching allowance units and operational configuration are required.",
                ]
              : []),
            ...(!markets.length
              ? [
                  "Confirm targeting and configure active reach with explicit source coverage.",
                ]
              : []),
          ],
          policy,
          availableMarkets: markets,
          offering: profile.offering,
          brief:
            profile.configuration?.homeMarketConfirmedAt &&
            profile.configuration.buyersReviewedAt
              ? briefFor(profile, markets, "")
              : null,
          runs,
          prospects: retained,
          counts: coverageCounts(retained),
        };
      });
    },
    create(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          await requireWorkSession(tx, actor, clock.now());
          await requireDiscoveryAvailable(tx, businessId);
          const [existing] = await tx
            .select()
            .from(discoveryRun)
            .where(
              and(
                eq(discoveryRun.businessId, businessId),
                eq(discoveryRun.requestKey, input.requestKey),
              ),
            );
          if (existing) {
            const [increase] = await tx
              .select()
              .from(discoveryCommand)
              .where(
                and(
                  eq(discoveryCommand.businessId, businessId),
                  eq(discoveryCommand.runId, existing.id),
                ),
              )
              .orderBy(asc(discoveryCommand.budgetBefore))
              .limit(1);
            const initialBudget = increase?.budgetBefore ?? existing.budget;
            if (
              existing.createdBy !== actor.userId ||
              existing.sessionId !== actor.sessionId
            )
              throw new ApplicationError("CONFLICT");
            if (
              initialBudget !== input.budget ||
              !isDeepStrictEqual(existing.brief.markets, input.markets) ||
              existing.brief.publicOffering !== input.publicOffering
            )
              throw new ApplicationError("CONFLICT");
            return {
              run: existing,
              work: {
                businessId,
                runId: existing.id,
                ...actor,
                executionKey: existing.executionId,
              },
            };
          }
          const { profile, policy } = await settings(
            tx,
            businessId,
            clock.now(),
          );
          if (!policy) throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
          const paid = await paidAllowance(
            tx,
            businessId,
            "discovery",
            clock.now(),
          );
          if (!paid || input.budget > paid.remaining)
            throw new ApplicationError("PAID_ACCESS_REQUIRED");
          if (
            input.budget > policy.maxRunBudget ||
            !input.markets.every((market) =>
              availableMarkets(profile, policy).includes(market),
            )
          )
            throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
          const id = randomUUID();
          const executionId = randomUUID();
          const [run] = await tx
            .insert(discoveryRun)
            .values({
              id,
              businessId,
              createdBy: actor.userId,
              executionUserId: actor.userId,
              sessionId: actor.sessionId,
              executionId,
              requestKey: input.requestKey,
              brief: briefFor(profile, input.markets, input.publicOffering),
              policy,
              status: "queued",
              budget: input.budget,
              createdAt: at,
              updatedAt: at,
            })
            .returning();
          await persistDispatch(
            tx,
            {
              kind: "discovery",
              work: {
                businessId,
                runId: id,
                ...actor,
                executionKey: executionId,
              },
            },
            at,
          );
          return {
            run,
            work: {
              businessId,
              runId: id,
              ...actor,
              executionKey: executionId,
            },
          };
        },
        { lock: true },
      );
    },
    command(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "profile.manage");
          await requireWorkSession(tx, actor, clock.now());
          const [run] = await tx
            .select()
            .from(discoveryRun)
            .where(
              and(
                eq(discoveryRun.id, input.runId),
                eq(discoveryRun.businessId, businessId),
              ),
            )
            .for("update");
          if (!run) throw new ApplicationError("NOT_FOUND");
          const [existing] = await tx
            .select()
            .from(discoveryCommand)
            .where(
              and(
                eq(discoveryCommand.businessId, businessId),
                eq(discoveryCommand.id, input.requestKey),
              ),
            );
          if (existing) {
            if (
              existing.actorId !== actor.userId ||
              existing.sessionId !== actor.sessionId ||
              !isDeepStrictEqual(existing.input, input)
            )
              throw new ApplicationError("CONFLICT");
            return {
              id: run.id,
              status: run.status,
              work:
                input.action === "resume" &&
                run.status === "queued" &&
                run.executionId === existing.executionId
                  ? {
                      businessId,
                      runId: run.id,
                      ...actor,
                      executionKey: existing.executionId,
                    }
                  : null,
            };
          }
          let executionId = run.executionId;
          let status = run.status;
          let budget = run.budget;
          if (input.action === "cancel") {
            if (
              input.expectedAttempt !== run.attempt ||
              !["queued", "running"].includes(run.status)
            )
              throw new ApplicationError("CONFLICT");
            await tx.execute(
              sql`select public.finish_discovery(${run.id}::uuid, ${businessId}::uuid, ${run.executionId}::uuid, 'cancelled', ${at.toISOString()}::timestamptz)`,
            );
            status = "stopped";
          } else {
            await checkCurrentScope(tx, run, clock.now());
            if (run.status !== "stopped")
              throw new ApplicationError("CONFLICT");
            if (input.action === "increase") {
              if (input.expectedBudget !== run.budget)
                throw new ApplicationError("CONFLICT");
              if (
                input.budget <= run.budget ||
                input.budget > run.policy.maxRunBudget
              )
                throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
              budget = input.budget;
              await tx
                .update(discoveryRun)
                .set({ budget, updatedAt: at })
                .where(eq(discoveryRun.id, run.id));
            } else {
              if (input.expectedAttempt !== run.attempt)
                throw new ApplicationError("CONFLICT");
              const usage = await tx
                .select()
                .from(discoveryUsage)
                .where(
                  and(
                    eq(discoveryUsage.businessId, businessId),
                    eq(discoveryUsage.runId, run.id),
                  ),
                );
              if (
                run.used >= run.budget ||
                usage.some(
                  (u) =>
                    u.stepKey === null ||
                    u.outcome === "reserved" ||
                    (u.kind !== "review" &&
                      u.outcome === "succeeded" &&
                      u.sources === null),
                )
              )
                throw new ApplicationError("CONFLICT");
              // Explicit run reauthorization binds the remaining checkpoint work
              // to the CURRENT active schedule revision, never a stale event.
              let scheduleRevision = run.scheduleRevision;
              if (run.scheduleId) {
                const [schedule] = await tx
                  .select()
                  .from(discoverySchedule)
                  .where(
                    and(
                      eq(discoverySchedule.id, run.scheduleId),
                      eq(discoverySchedule.businessId, businessId),
                    ),
                  );
                if (!schedule || schedule.status !== "active")
                  throw new ApplicationError("CONFLICT");
                scheduleRevision = schedule.revision;
              }
              executionId = randomUUID();
              status = "queued";
              await tx
                .update(discoveryRun)
                .set({
                  executionId,
                  scheduleRevision,
                  executionUserId: actor.userId,
                  sessionId: actor.sessionId,
                  status,
                  stopReason: null,
                  attempt: run.attempt + 1,
                  attemptStartedAt: null,
                  durableRunId: null,
                  durableAttempt: 0,
                  updatedAt: at,
                })
                .where(eq(discoveryRun.id, run.id));
            }
          }
          const priorCommands = await tx
            .select({ id: discoveryCommand.id })
            .from(discoveryCommand)
            .where(
              and(
                eq(discoveryCommand.businessId, businessId),
                eq(discoveryCommand.runId, run.id),
              ),
            );
          await tx.insert(discoveryCommand).values({
            position: priorCommands.length,
            id: input.requestKey,
            businessId,
            runId: run.id,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            executionId,
            input,
            budgetBefore: run.budget,
            budgetAfter: budget,
            stopReason: run.stopReason,
            at,
          });
          if (input.action === "resume")
            await persistDispatch(
              tx,
              {
                kind: "discovery",
                work: {
                  businessId,
                  runId: run.id,
                  ...actor,
                  executionKey: executionId,
                },
              },
              at,
            );
          return {
            id: run.id,
            status,
            work:
              input.action === "resume"
                ? {
                    businessId,
                    runId: run.id,
                    ...actor,
                    executionKey: executionId,
                  }
                : null,
          };
        },
        { lock: true },
      );
    },
    claim(work, at, durable) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          await requireWorkSession(tx, work, clock.now());
          await schedules.checkScheduleForRun(tx, run);
          if (
            run.status === "running" &&
            durable &&
            run.durableRunId === durable.runId &&
            durable.number > run.durableAttempt
          ) {
            const [uncertain] = await tx
              .select({ id: discoveryUsage.id })
              .from(discoveryUsage)
              .where(
                and(
                  eq(discoveryUsage.runId, run.id),
                  eq(discoveryUsage.businessId, work.businessId),
                  inArray(discoveryUsage.outcome, [
                    "reserved",
                    "failed",
                    "uncertain",
                  ]),
                ),
              )
              .limit(1);
            if (uncertain) {
              await tx.execute(
                sql`select public.finish_discovery(${run.id}::uuid, ${work.businessId}::uuid, ${work.executionKey}::uuid, 'worker_lost', ${at.toISOString()}::timestamptz)`,
              );
              return null;
            }
          } else if (run.status !== "queued") return null;
          await checkCurrent(tx, run, clock.now());
          await tx
            .update(discoveryRun)
            .set({
              status: "running",
              updatedAt: at,
              stopReason: null,
              durableRunId: durable?.runId ?? null,
              durableAttempt: durable?.number ?? 0,
              attemptStartedAt: run.attemptStartedAt ?? at,
            })
            .where(eq(discoveryRun.id, run.id));
          return {
            ...run,
            status: "running",
            attemptStartedAt: run.attemptStartedAt ?? at,
          };
        },
        { lock: true },
      );
    },
    reserve(work, kind, query, at, stepKey) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          await requireWorkSession(tx, work, clock.now());
          if (run.status !== "running") return null;
          await checkCurrent(tx, run, clock.now());
          await schedules.checkScheduleForRun(tx, run);
          const previous = await tx
            .select()
            .from(discoveryUsage)
            .where(
              and(
                eq(discoveryUsage.businessId, work.businessId),
                eq(discoveryUsage.runId, run.id),
                eq(discoveryUsage.stepKey, stepKey),
              ),
            );
          const completed = previous.find((u) => u.outcome === "succeeded");
          if (completed)
            return {
              id: completed.id,
              units: completed.units,
              completed: true,
              sources:
                completed.sources === null
                  ? null
                  : z
                      .array(searchResultSchema)
                      .max(run.policy.maxResults)
                      .parse(completed.sources),
            };
          // One outbound attempt per logical step per explicit execution. A failed or
          // ambiguous call stays charged; only another authorized resume can retry it.
          if (
            previous.some(
              (u) =>
                u.executionId === work.executionKey || u.outcome === "reserved",
            )
          )
            throw new ApplicationError("CONFLICT");
          if (run.policy.exa) {
            // Shared across resumes and durable deliveries under the same lock.
            if (previous.length >= run.policy.exa.maxAttemptsPerStep)
              return null;
            if (kind !== "review") {
              const calls = await tx
                .select({ id: discoveryUsage.id })
                .from(discoveryUsage)
                .where(
                  and(
                    eq(discoveryUsage.runId, run.id),
                    eq(discoveryUsage.businessId, work.businessId),
                    inArray(discoveryUsage.kind, ["search", "contents"]),
                  ),
                );
              if (calls.length >= run.policy.exa.maxCalls) return null;
            }
          }
          const units =
            kind === "search"
              ? run.policy.searchUnits
              : kind === "contents"
                ? run.policy.exa?.contentsUnits
                : run.policy.reviewUnits;
          if (!units) throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
          if (run.used + units > run.budget) return null;
          const id = randomUUID();
          await reservePaidUsage(
            tx,
            work.businessId,
            "discovery",
            id,
            units,
            run.policy.allowanceUnit,
            at,
          );
          await tx
            .update(discoveryRun)
            .set({ used: run.used + units, updatedAt: at })
            .where(eq(discoveryRun.id, run.id));
          await tx.insert(discoveryUsage).values({
            id,
            runId: run.id,
            businessId: work.businessId,
            kind,
            units,
            position: run.used,
            outcome: "reserved",
            stepKey,
            executionId: work.executionKey,
            query: run.policy.permissions.retainQueries ? query : null,
            at,
          });
          // Paid/usage serialization may wait after native availability was
          // confirmed. Recheck current authority before committing a call.
          await checkCurrent(tx, run, clock.now());
          return { id, units, completed: false, sources: null };
        },
        { lock: true },
      );
    },
    recordProviderCost(work, operationId, value) {
      return scoped(database, work, work.businessId, async (tx) => {
        const run = await ownedRun(tx, work);
        await requireWorkSession(tx, work, clock.now());
        const parsed = discoveryProviderCostSchema.safeParse(value);
        if (!parsed.success)
          throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
        const [usage] = await tx
          .select()
          .from(discoveryUsage)
          .where(
            and(
              eq(discoveryUsage.id, operationId),
              eq(discoveryUsage.runId, run.id),
              eq(discoveryUsage.businessId, work.businessId),
            ),
          );
        if (!usage || usage.kind === "review")
          throw new ApplicationError("NOT_FOUND");
        if (usage.providerCost) {
          if (!isDeepStrictEqual(usage.providerCost, parsed.data))
            throw new ApplicationError("CONFLICT");
          return;
        }
        await tx
          .update(discoveryUsage)
          .set({ providerCost: parsed.data })
          .where(eq(discoveryUsage.id, usage.id));
      });
    },
    record(work, operationId, prospect, at, details) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          if (run.status !== "running") return;
          const [usage] = await tx
            .select()
            .from(discoveryUsage)
            .where(
              and(
                eq(discoveryUsage.id, operationId),
                eq(discoveryUsage.runId, run.id),
                eq(discoveryUsage.businessId, work.businessId),
              ),
            );
          if (usage?.outcome === "succeeded") return;
          if (!usage || usage.outcome !== "reserved")
            throw new ApplicationError("CONFLICT");
          const [lastCheck] = await tx
            .select({
              order:
                sql<number>`coalesce(max(${discoveryUsage.checkOrder}), 0)`.mapWith(
                  Number,
                ),
            })
            .from(discoveryUsage)
            .where(eq(discoveryUsage.businessId, work.businessId));
          const checkOrder =
            usage.kind === "review" ? lastCheck.order + 1 : null;
          if (prospect) {
            let data = persistedProspectSchema.parse(prospect);
            const url = data.evidence[0].url;
            const keys = identityKeys(data, run.brief);
            const aliases = await tx
              .select()
              .from(discoveryProspectAlias)
              .where(
                and(
                  eq(discoveryProspectAlias.businessId, work.businessId),
                  inArray(discoveryProspectAlias.key, keys),
                ),
              );
            const prior = await observationsFor(tx, work.businessId);
            const contradictsIdentity = (id: string) =>
              prior.some(
                (o) =>
                  o.prospectId === id &&
                  ((data.company !== null &&
                    o.data.company !== null &&
                    companyIdentity(o.data) !== companyIdentity(data)) ||
                    (data.request?.reference &&
                      o.data.request?.reference &&
                      data.request.reference.url !==
                        o.data.request.reference.url)),
              );
            let prospectId: string | undefined = keys.flatMap((key) =>
              aliases
                .filter(
                  (a) => a.key === key && !contradictsIdentity(a.prospectId),
                )
                .map((a) => a.prospectId),
            )[0];
            // Adopt exact legacy observations without rewriting their identity/history.
            if (!prospectId) {
              const legacy = await tx
                .select({ result: discoveryResult, brief: discoveryRun.brief })
                .from(discoveryResult)
                .innerJoin(
                  discoveryRun,
                  and(
                    eq(discoveryRun.id, discoveryResult.runId),
                    eq(discoveryRun.businessId, work.businessId),
                  ),
                )
                .where(eq(discoveryResult.businessId, work.businessId));
              prospectId = legacy.find(
                ({ result, brief }) =>
                  !contradictsIdentity(result.prospectId) &&
                  identityKeys(
                    persistedProspectSchema.parse(result.data),
                    brief,
                  ).some((key) => keys.includes(key)),
              )?.result.prospectId;
            }
            const created = !prospectId;
            if (!prospectId) {
              prospectId = randomUUID();
              await tx.insert(discoveryProspect).values({
                id: prospectId,
                businessId: work.businessId,
                canonicalUrl: url,
              });
            }
            const previousContacts = prior
              .filter((o) => o.prospectId === prospectId)
              .flatMap(
                (o) => contactIdentities(o.data, work.businessId).contacts,
              );
            data = contactIdentities(
              {
                ...data,
                contacts: data.contacts.map((contact) => {
                  const previous = previousContacts.find(
                    (c) =>
                      c.name?.toLowerCase() === contact.name?.toLowerCase() &&
                      isDeepStrictEqual(
                        c.route && { kind: c.route.kind, value: c.route.value },
                        contact.route && {
                          kind: contact.route.kind,
                          value: contact.route.value,
                        },
                      ),
                  );
                  return previous?.id
                    ? { ...contact, id: previous.id }
                    : contact;
                }),
              },
              work.businessId,
            );
            data = {
              ...data,
              identityConflict: aliases.some(
                (a) =>
                  a.prospectId !== prospectId &&
                  !prior.some(
                    (o) =>
                      o.prospectId === a.prospectId &&
                      data.request?.reference &&
                      o.data.request?.reference &&
                      data.request.reference.url !==
                        o.data.request.reference.url,
                  ),
              ),
            };
            await tx
              .insert(discoveryProspectAlias)
              .values(
                keys.map((key) => ({
                  businessId: work.businessId,
                  key,
                  prospectId,
                })),
              )
              .onConflictDoNothing();
            const [sameRun] = await tx
              .select({ id: discoveryResult.prospectId })
              .from(discoveryResult)
              .where(
                and(
                  eq(discoveryResult.businessId, work.businessId),
                  eq(discoveryResult.runId, run.id),
                  eq(discoveryResult.prospectId, prospectId),
                ),
              );
            await tx.insert(discoveryObservation).values({
              id: operationId,
              businessId: work.businessId,
              runId: run.id,
              prospectId,
              data,
              checkedAt: new Date(data.evidence[0].checkedAt),
              outcome: created
                ? "created"
                : sameRun
                  ? "duplicate"
                  : "refreshed",
            });
            await tx
              .insert(discoveryResult)
              .values({
                runId: run.id,
                prospectId,
                businessId: work.businessId,
                data,
              })
              .onConflictDoNothing();
          }
          await tx
            .update(discoveryUsage)
            .set({
              outcome: "succeeded",
              ...(usage.kind !== "review"
                ? {
                    returnedResults: details?.returnedResults ?? null,
                    sources: details?.sources
                      ? z
                          .array(searchResultSchema)
                          .max(run.policy.maxResults)
                          .parse(details.sources)
                      : null,
                  }
                : {
                    sourceUrl: details?.sourceUrl
                      ? evidenceUrlSchema.parse(details.sourceUrl)
                      : null,
                    checkedAt: at,
                    checkOrder,
                  }),
            })
            .where(eq(discoveryUsage.id, operationId));
          await tx
            .update(discoveryRun)
            .set({ updatedAt: at })
            .where(eq(discoveryRun.id, run.id));
        },
        { lock: true },
      );
    },
    progress(work, at, searchKey) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          if (
            run.status === "running" &&
            !run.completedSearchKeys.includes(searchKey)
          )
            await tx
              .update(discoveryRun)
              .set({
                completedSteps: run.completedSteps + 1,
                completedSearchKeys: [...run.completedSearchKeys, searchKey],
                updatedAt: at,
              })
              .where(eq(discoveryRun.id, run.id));
        },
        { lock: true },
      );
    },
    async finish(work, reason, at) {
      // Capability permits only terminalization, even after session/membership revocation.
      // It cannot read results, reserve spend, resume a run, or create prospects.
      await database.execute(
        sql`select public.finish_discovery(${work.runId}::uuid, ${work.businessId}::uuid, ${work.executionKey}::uuid, ${reason}, ${at.toISOString()}::timestamptz)`,
      );
    },
    async failOperation(work, operationId) {
      await database.execute(
        sql`select public.fail_discovery_operation(${work.runId}::uuid, ${work.businessId}::uuid, ${work.executionKey}::uuid, ${operationId}::uuid)`,
      );
    },
  };
}
