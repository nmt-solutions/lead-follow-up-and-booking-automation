import { and, desc, eq, sql } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./runtime";
import { scoped, type Transaction } from "./scope";
import {
  discoveryCapacityPolicy,
  discoveryCapacityBinding,
  discoveryRun,
  discoverySchedule,
  platformOperator,
  session,
} from "./schema";
import {
  capacityRouteSchema,
  type CapacityRoute,
  type CapacityDeployment,
} from "../models/discovery-capacity";
import type { Actor } from "../models/business";
import type { DiscoveryWork } from "../models/discovery";
import { requireCapability } from "./scope";
import {
  checkCurrent,
  requireWorkSession,
  requireDiscoveryAvailable,
} from "./discovery-state";
import type { WorkIdentity } from "../models/discovery";
import { configureCapacitySchema } from "../models/discovery-capacity";
import { ApplicationError } from "../models/application-error";
import { hasMfa, operatorMfaLifetime } from "../auth/access";

export async function capacityTime(tx: Transaction) {
  const result = await tx.execute<{ at: Date }>(
    sql`select clock_timestamp() at`,
  );
  return new Date(result.rows[0].at);
}
async function operator(tx: Transaction, actor: WorkIdentity) {
  const [grant] = await tx
    .select()
    .from(platformOperator)
    .where(eq(platformOperator.userId, actor.userId));
  if (!grant?.discovery) throw new ApplicationError("FORBIDDEN");
  const [identity] = await tx
    .select()
    .from(session)
    .where(
      and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)),
    );
  const at = await capacityTime(tx);
  if (!identity || identity.expiresAt <= at)
    throw new ApplicationError("UNAUTHENTICATED");
  if (!(await hasMfa(tx, identity.token, at, operatorMfaLifetime)))
    throw new ApplicationError("MFA_REQUIRED");
}
const view = (row: typeof discoveryCapacityPolicy.$inferSelect) => ({
  ...row,
  at: row.at.toISOString(),
});
async function routeFor(
  tx: Transaction,
  businessId: string,
  deployment?: CapacityDeployment,
) {
  const result = await tx.execute<{ route: unknown }>(
    sql`select public.discovery_capacity_route(${businessId}::uuid, ${deployment ? JSON.stringify(deployment) : null}::jsonb) route`,
  );
  return capacityRouteSchema.nullable().parse(result.rows[0]?.route ?? null);
}
export async function bindDiscoveryCapacity(
  tx: Transaction,
  work: DiscoveryWork,
) {
  const route = await routeFor(tx, work.businessId);
  if (!route) return;
  await tx
    .insert(discoveryCapacityBinding)
    .values({
      id: work.executionKey,
      businessId: work.businessId,
      runId: work.runId,
      policyId: route.policyId,
      route,
      at: await capacityTime(tx),
    })
    .onConflictDoNothing();
}
export async function requireCapacityBindingCurrent(
  tx: Transaction,
  run: Pick<typeof discoveryRun.$inferSelect, "businessId"> & {
    executionId: string | null;
  },
) {
  if (!run.executionId) return;
  const [binding] = await tx
    .select()
    .from(discoveryCapacityBinding)
    .where(
      and(
        eq(discoveryCapacityBinding.id, run.executionId),
        eq(discoveryCapacityBinding.businessId, run.businessId),
      ),
    );
  if (!binding) return;
  const current = await routeFor(tx, run.businessId);
  if (!current || !isDeepStrictEqual(binding.route, current))
    throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
}
export function createDiscoveryCapacityRepository(database: Database) {
  return {
    route(actor: Actor, businessId: string, deployment?: CapacityDeployment) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "sales.work");
        const route = await routeFor(tx, businessId, deployment);
        return { route, at: (await capacityTime(tx)).toISOString() };
      });
    },
    plan(work: DiscoveryWork, deployment?: CapacityDeployment) {
      return scoped(
        database,
        work,
        work.businessId,
        async (tx) => {
          await requireCapability(tx, work, work.businessId, "profile.manage");
          await requireDiscoveryAvailable(tx, work.businessId);
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
          await requireWorkSession(tx, work, await capacityTime(tx));
          if (
            !run ||
            run.executionId !== work.executionKey ||
            run.executionUserId !== work.userId ||
            run.sessionId !== work.sessionId
          )
            throw new ApplicationError("NOT_FOUND");
          await requireCapability(tx, work, work.businessId, "profile.manage");
          await checkCurrent(tx, run, await capacityTime(tx));
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
          const [binding] = await tx
            .select()
            .from(discoveryCapacityBinding)
            .where(
              and(
                eq(discoveryCapacityBinding.id, work.executionKey),
                eq(discoveryCapacityBinding.businessId, work.businessId),
              ),
            );
          if (!binding) return null;
          const current = await routeFor(tx, work.businessId, deployment);
          if (!current && deployment) return null;
          if (!current || !isDeepStrictEqual(binding.route, current))
            throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
          return {
            route: binding.route,
            preparedAt: (await capacityTime(tx)).toISOString(),
          };
        },
        { lock: true },
      );
    },
    async confirm(
      work: DiscoveryWork,
      plan: { route: CapacityRoute; preparedAt: string },
      deployment?: CapacityDeployment,
    ) {
      const current = await this.plan(work, deployment);
      if (!current || !isDeepStrictEqual(current.route, plan.route))
        throw new ApplicationError("DISCOVERY_SCOPE_INVALID");
      if (
        new Date(current.preparedAt).getTime() -
          new Date(plan.preparedAt).getTime() >
        plan.route.maxObservationAgeMs
      )
        return false;
      return true;
    },
    configure(
      actor: WorkIdentity,
      input: z.infer<typeof configureCapacitySchema>,
    ) {
      return scoped(database, actor, "", async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('discovery-capacity',0))`,
        );
        await operator(tx, actor);
        const [previous] = await tx
          .select()
          .from(discoveryCapacityPolicy)
          .where(eq(discoveryCapacityPolicy.requestKey, input.requestKey));
        if (previous) {
          if (
            previous.actorId !== actor.userId ||
            previous.sessionId !== actor.sessionId ||
            previous.version - 1 !== input.expectedVersion ||
            !isDeepStrictEqual(previous.policy, input.policy)
          )
            throw new ApplicationError("CONFLICT");
          await operator(tx, actor);
          return view(previous);
        }
        const [latest] = await tx
          .select()
          .from(discoveryCapacityPolicy)
          .orderBy(desc(discoveryCapacityPolicy.version))
          .limit(1);
        if ((latest?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const at = await capacityTime(tx);
        if (new Date(input.policy.validUntil) <= at)
          throw new ApplicationError("INVALID_INPUT");
        const [saved] = await tx
          .insert(discoveryCapacityPolicy)
          .values({
            id: randomUUID(),
            version: input.expectedVersion + 1,
            requestKey: input.requestKey,
            actorId: actor.userId,
            sessionId: actor.sessionId,
            policy: input.policy,
            at,
          })
          .returning();
        await operator(tx, actor);
        return view(saved);
      });
    },
    configuration(actor: WorkIdentity) {
      return scoped(database, actor, "", async (tx) => {
        await operator(tx, actor);
        const rows = await tx
          .select()
          .from(discoveryCapacityPolicy)
          .orderBy(desc(discoveryCapacityPolicy.version))
          .limit(50);
        await operator(tx, actor);
        return { revisions: rows.map(view) };
      });
    },
  };
}
