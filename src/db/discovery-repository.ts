import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  business,
  discoveryConfiguration,
  discoveryRun,
  discoveryProspect,
  discoveryResult,
  discoveryUsage,
  discoveryProspectAlias,
  discoveryObservation,
  session,
} from "./schema";
import { ApplicationError } from "../models/application-error";
import {
  discoveryPolicySchema,
  persistedProspectSchema,
  observationOutcomeSchema,
  sourceCheckSchema,
  evidenceUrlSchema,
  type DiscoveryRun,
  type DiscoveryWork,
  type DiscoveryBrief,
  type RunView,
} from "../models/discovery";
import {
  availableMarkets,
  type DiscoveryRepository,
} from "../discovery/repository";
import type { BusinessProfile, Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import { hasMfa } from "../auth/access";
import { coverageCounts } from "../discovery/evidence";
import {
  consolidateViews,
  contactIdentities,
  companyIdentity,
  identityKeys,
  type RetainedObservation,
} from "../discovery/consolidation";

async function observationsFor(
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

async function requireWorkSession(
  tx: Transaction,
  identity: WorkIdentity,
  at: Date,
) {
  const [current] = await tx
    .select({ token: session.token, expiresAt: session.expiresAt })
    .from(session)
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
      ),
    );
  if (!current || current.expiresAt <= at)
    throw new ApplicationError("UNAUTHENTICATED");
  // Run authorizers are Owners/Admins, so queued spend always requires MFA.
  if (!(await hasMfa(tx, current.token, at)))
    throw new ApplicationError("MFA_REQUIRED");
}

function briefFor(
  profile: BusinessProfile,
  markets: string[],
  publicOffering: string,
): DiscoveryBrief {
  const configuration = profile.configuration;
  if (!configuration?.homeMarketConfirmedAt || !configuration.buyersReviewedAt)
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
  return {
    offering: profile.offering,
    publicOffering,
    requirements: {
      specifications: configuration.specifications,
      minimumOrder: configuration.minimumOrder,
      deliveryConstraints: configuration.deliveryConstraints,
      serviceConstraints: configuration.serviceConstraints,
    },
    buyers: configuration.buyerCategories,
    markets,
    exclusions: configuration.exclusions,
    homeMarket: profile.homeMarket,
  };
}

async function settings(tx: Transaction, businessId: string) {
  const [profile] = await tx
    .select()
    .from(business)
    .where(eq(business.id, businessId));
  if (!profile) throw new ApplicationError("NOT_FOUND");
  const [configuration] = await tx
    .select()
    .from(discoveryConfiguration)
    .where(eq(discoveryConfiguration.businessId, businessId));
  const parsed = discoveryPolicySchema.safeParse(configuration?.policy);
  return { profile, policy: parsed.success ? parsed.data : null };
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
    run.createdBy !== work.userId ||
    run.sessionId !== work.sessionId ||
    run.executionId !== work.executionKey
  )
    throw new ApplicationError("NOT_FOUND");
  return run;
}

async function checkCurrent(tx: Transaction, run: DiscoveryRun) {
  const { profile, policy } = await settings(tx, run.businessId);
  if (
    !policy ||
    !isDeepStrictEqual(policy, run.policy) ||
    !run.brief.markets.every((market) =>
      availableMarkets(profile, policy).includes(market),
    ) ||
    !isDeepStrictEqual(
      briefFor(profile, run.brief.markets, run.brief.publicOffering),
      run.brief,
    )
  )
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
}

export function createDiscoveryRepository(
  database: Database,
  clock: Clock,
): DiscoveryRepository {
  return {
    workspace(actor, businessId) {
      return scoped(database, actor, businessId, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        const { profile, policy } = await settings(tx, businessId);
        const markets = availableMarkets(profile, policy);
        const rows = await tx
          .select()
          .from(discoveryRun)
          .where(eq(discoveryRun.businessId, businessId))
          .orderBy(desc(discoveryRun.createdAt), desc(discoveryRun.id))
          .limit(50);
        const runs: RunView[] = [];
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
        const retained = consolidateViews(
          observations,
          businessId,
          clock.now(),
          checks,
        );
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
          runs.push({
            id: row.id,
            businessId,
            brief: row.brief,
            createdBy: row.createdBy,
            status: row.status,
            stopReason: row.stopReason,
            budget: row.budget,
            used: row.used,
            completedSteps: row.completedSteps,
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
        return {
          canRun: role !== "salesperson",
          setup: [
            ...(!policy
              ? ["Operator discovery configuration is missing or invalid."]
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
            if (
              existing.createdBy !== actor.userId ||
              existing.sessionId !== actor.sessionId
            )
              throw new ApplicationError("CONFLICT");
            if (
              existing.budget !== input.budget ||
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
          const { profile, policy } = await settings(tx, businessId);
          if (!policy) throw new ApplicationError("DISCOVERY_SETUP_REQUIRED");
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
    claim(work, at) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          await requireWorkSession(tx, work, clock.now());
          if (run.status !== "queued") return null;
          await checkCurrent(tx, run);
          await tx
            .update(discoveryRun)
            .set({ status: "running", updatedAt: at })
            .where(eq(discoveryRun.id, run.id));
          return { ...run, status: "running" };
        },
        { lock: true },
      );
    },
    reserve(work, kind, query, at) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          await requireWorkSession(tx, work, clock.now());
          if (run.status !== "running") return null;
          await checkCurrent(tx, run);
          const units =
            kind === "search" ? run.policy.searchUnits : run.policy.reviewUnits;
          if (run.used + units > run.budget) return null;
          const id = randomUUID();
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
            query: run.policy.permissions.retainQueries ? query : null,
            at,
          });
          return { id, units };
        },
        { lock: true },
      );
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
              ...(usage.kind === "search"
                ? { returnedResults: details?.returnedResults ?? null }
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
    progress(work, at) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          const run = await ownedRun(tx, work);
          if (run.status === "running")
            await tx
              .update(discoveryRun)
              .set({ completedSteps: run.completedSteps + 1, updatedAt: at })
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
