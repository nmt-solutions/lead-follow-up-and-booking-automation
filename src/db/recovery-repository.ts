import { and, asc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  recoveryPlanSchema,
  recoveryStageSchema,
  recoveryOutcomeSchema,
  recoveryEvidenceSchema,
  type RecoveryPlan,
  type RecoveryOperation,
  type RecoveryEvidence,
  type RecoveryStage,
} from "../models/infrastructure-recovery";
import type { Database } from "./runtime";
import {
  infrastructureRecovery,
  infrastructureRecoveryEvent,
  platformOperator,
  session,
} from "./schema";
import { scoped, type Transaction } from "./scope";

export function createRecoveryRepository(database: Database, clock: Clock) {
  async function access<T>(
    actor: WorkIdentity,
    businessId: string,
    fn: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(database, actor, businessId, async (tx) => {
      await tx.execute(
        sql`select set_config('app.recovery_session',${actor.sessionId},true)`,
      );
      const [grant] = await tx
        .select()
        .from(platformOperator)
        .where(eq(platformOperator.userId, actor.userId));
      if (!grant?.recovery) throw new ApplicationError("FORBIDDEN");
      const [proof] = await tx
        .select()
        .from(session)
        .where(
          and(
            eq(session.id, actor.sessionId),
            eq(session.userId, actor.userId),
          ),
        );
      if (
        !proof ||
        !(await hasMfa(tx, proof.token, clock.now(), operatorMfaLifetime))
      )
        throw new ApplicationError("MFA_REQUIRED");
      return fn(tx);
    });
  }
  async function read(tx: Transaction, businessId: string) {
    const operations = await tx
      .select()
      .from(infrastructureRecovery)
      .where(eq(infrastructureRecovery.businessId, businessId))
      .orderBy(asc(infrastructureRecovery.at));
    const events = await tx
      .select()
      .from(infrastructureRecoveryEvent)
      .where(eq(infrastructureRecoveryEvent.businessId, businessId))
      .orderBy(asc(infrastructureRecoveryEvent.position));
    return operations.map((r) => ({
      id: r.id,
      businessId: r.businessId,
      actorId: r.actorId,
      sessionId: r.sessionId,
      requestKey: r.requestKey,
      plan: recoveryPlanSchema.parse(r.plan),
      planHash: r.planHash,
      stage: recoveryStageSchema.parse(r.stage),
      at: r.at.toISOString(),
      events: events
        .filter((e) => e.operationId === r.id)
        .map((e) => ({
          stage: recoveryStageSchema.parse(e.stage),
          outcome: recoveryOutcomeSchema.parse(e.outcome),
          at: e.at.toISOString(),
          evidence: recoveryEvidenceSchema.strip().parse(e.evidence),
        })),
    }));
  }
  return {
    authorize: (actor: WorkIdentity, businessId = "") =>
      access(actor, businessId, async () => {}),
    authorizeAttempt: (
      actor: WorkIdentity,
      operation: RecoveryOperation,
      key: string,
    ) =>
      access(actor, operation.businessId, async (tx) => {
        const result = await tx.execute<{ current: boolean }>(sql`select exists(
          select 1 from public.infrastructure_recovery r where r.id=${operation.id}::uuid
          and r.business_id=${operation.businessId}::uuid and r.actor_id=${actor.userId}
          and r.authorized_session_id=${actor.sessionId} and r.lease=${key}::uuid
          and r.lease_until>clock_timestamp() and r.stage=${operation.stage}
          and r.plan=${JSON.stringify(operation.plan)}::jsonb and r.plan_hash=${operation.planHash}
          and (r.plan->>'retainUntil')::timestamptz>clock_timestamp()
          and (r.plan->>'observationExpiresAt')::timestamptz>clock_timestamp()
          and public.recovery_operator_authorized()) as current`);
        if (!result.rows[0]?.current) throw new ApplicationError("CONFLICT");
      }),
    list: (actor: WorkIdentity, businessId: string) =>
      access(actor, businessId, (tx) => read(tx, businessId)),
    request(actor: WorkIdentity, plan: RecoveryPlan, requestKey: string) {
      return access(actor, plan.businessId, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`recovery:${requestKey}`},0))`,
        );
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`recovery-plan:${plan.id}`},0))`,
        );
        const existing = await read(tx, plan.businessId);
        const prior =
          existing.find((r) => r.requestKey === requestKey) ??
          existing.find((r) => r.plan.id === plan.id);
        if (prior) {
          if (
            prior.actorId !== actor.userId ||
            JSON.stringify(prior.plan) !==
              JSON.stringify(recoveryPlanSchema.parse(plan))
          )
            throw new ApplicationError("CONFLICT");
          return prior;
        }
        const id = randomUUID();
        await tx.insert(infrastructureRecovery).values({
          id,
          businessId: plan.businessId,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          authorizedSessionId: actor.sessionId,
          requestKey,
          plan,
          planHash: sql`encode(sha256(convert_to(${JSON.stringify(plan)}::jsonb::text,'UTF8')),'hex')`,
        });
        return (await read(tx, plan.businessId)).find((r) => r.id === id)!;
      });
    },
    async get(
      actor: WorkIdentity,
      businessId: string,
      id: string,
    ): Promise<RecoveryOperation> {
      const r = (
        await access(actor, businessId, (tx) => read(tx, businessId))
      ).find((r) => r.id === id);
      if (!r) throw new ApplicationError("NOT_FOUND");
      return r;
    },
    delegate: (actor: WorkIdentity, businessId: string, id: string) =>
      access(actor, businessId, async (tx) => {
        await tx.execute(
          sql`select public.delegate_infrastructure_recovery(${id}::uuid)`,
        );
      }),
    async work() {
      return (
        await database.execute<{
          id: string;
          business_id: string;
          actor_id: string;
          session_id: string;
        }>(sql`select * from public.pending_infrastructure_recovery()`)
      ).rows;
    },
    claim: (actor: WorkIdentity, businessId: string, id: string) =>
      access(
        actor,
        businessId,
        async (tx) =>
          (
            await tx.execute<{ key: string | null }>(
              sql`select public.claim_infrastructure_recovery(${id}::uuid) as key`,
            )
          ).rows[0].key,
      ),
    finish: (
      actor: WorkIdentity,
      businessId: string,
      id: string,
      key: string,
      stage: RecoveryStage,
      outcome: "completed" | "failed" | "ambiguous",
      evidence: RecoveryEvidence,
    ) =>
      access(actor, businessId, async (tx) => {
        await tx.execute(
          sql`select public.finish_infrastructure_recovery(${id}::uuid,${key}::uuid,${stage},${outcome},${JSON.stringify(evidence)}::jsonb)`,
        );
      }),
    recordIncurred: (
      actor: WorkIdentity,
      operation: RecoveryOperation,
      key: string,
      evidence: RecoveryEvidence,
    ) =>
      scoped(database, actor, operation.businessId, async (tx) => {
        await tx.execute(
          sql`select set_config('app.recovery_session',${actor.sessionId},true)`,
        );
        await tx.execute(
          sql`select public.finish_infrastructure_recovery(${operation.id}::uuid,${key}::uuid,${operation.stage},'ambiguous',${JSON.stringify(evidence)}::jsonb)`,
        );
      }),
  };
}
