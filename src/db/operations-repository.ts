import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  operationSnapshotSchema,
  type RecoveryCommand,
  type OperationEvent,
  type DiagnosticRetention,
  type OperationQuery,
} from "../models/operations";
import type { Database } from "./runtime";
import {
  operationEvent,
  operationRetention,
  operationDetail,
  platformOperator,
  session,
  inboxOpportunity,
} from "./schema";
import { requireCapability, scoped, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import { mailboxWorkSchema } from "../models/mailboxes";

export function createOperationsRepository(database: Database, clock: Clock) {
  async function access<T>(
    identity: WorkIdentity,
    businessId: string,
    operator: boolean,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      identity,
      businessId,
      async (tx) => {
        await tx.execute(
          sql`select set_config('app.operation_session',${identity.sessionId},true)`,
        );
        if (operator) {
          const [grant] = await tx
            .select()
            .from(platformOperator)
            .where(eq(platformOperator.userId, identity.userId));
          if (!grant?.operations) throw new ApplicationError("FORBIDDEN");
          const [proof] = await tx
            .select()
            .from(session)
            .where(
              and(
                eq(session.id, identity.sessionId),
                eq(session.userId, identity.userId),
              ),
            );
          if (
            !proof ||
            !(await hasMfa(tx, proof.token, clock.now(), operatorMfaLifetime))
          )
            throw new ApplicationError("MFA_REQUIRED");
        } else {
          const role = await requireCapability(
            tx,
            identity,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, identity, clock.now(), role);
        }
        return operation(tx);
      },
      { at: clock.now() },
    );
  }
  function view(row: typeof operationEvent.$inferSelect): OperationEvent {
    return {
      ...operationSnapshotSchema.parse(row.snapshot),
      id: row.id,
      position: row.position,
      actorId: row.actorId,
      action: row.action,
      outcome: row.outcome,
      requestKey: row.requestKey,
      at: row.at.toISOString(),
    };
  }
  return {
    access,
    async maintainRetention() {
      const result = await database.execute<{ deleted: number }>(
        sql`select public.maintain_operation_retention() as deleted`,
      );
      return { deleted: result.rows[0].deleted };
    },
    acknowledge(
      identity: WorkIdentity,
      businessId: string,
      eventId: string,
      requestKey: string,
      operator: boolean,
    ) {
      return access(identity, businessId, operator, async (tx) => {
        const [event] = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              eq(operationEvent.id, eventId),
              eq(operationEvent.businessId, businessId),
            ),
          );
        if (!event || !["observed", "escalated"].includes(event.outcome))
          throw new ApplicationError("NOT_FOUND");
        if (!operator) {
          const [currentOwner] = event.snapshot.opportunityId
            ? await tx
                .select({ id: inboxOpportunity.ownerId })
                .from(inboxOpportunity)
                .where(
                  and(
                    eq(inboxOpportunity.id, event.snapshot.opportunityId),
                    eq(inboxOpportunity.businessId, businessId),
                  ),
                )
            : [];
          if (
            (currentOwner?.id ?? event.snapshot.responsibleUserId) !==
            identity.userId
          )
            throw new ApplicationError("FORBIDDEN");
        }
        await tx
          .insert(operationEvent)
          .values({
            id: randomUUID(),
            businessId,
            source: event.source,
            targetId: event.targetId,
            snapshot: {
              ...event.snapshot,
              context: {
                ...event.snapshot.context,
                notificationId: eventId,
                notificationAudience: operator ? "operator" : "business",
              },
            },
            actorId: identity.userId,
            action: "acknowledge",
            outcome: "acknowledged",
            requestKey,
          })
          .onConflictDoNothing();
      });
    },
    retention(identity: WorkIdentity) {
      return access(identity, "", true, async (tx) => {
        const [row] = await tx
          .select()
          .from(operationRetention)
          .orderBy(desc(operationRetention.version))
          .limit(1);
        return row
          ? {
              version: row.version,
              diagnosticSeconds: row.policy.diagnosticSeconds,
              auditDetailSeconds: row.policy.auditDetailSeconds,
              evidenceRef: row.policy.evidenceRef,
            }
          : null;
      });
    },
    saveRetention(identity: WorkIdentity, policy: DiagnosticRetention) {
      return access(identity, "", true, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended('operations-retention',0))`,
        );
        const [current] = await tx
          .select()
          .from(operationRetention)
          .orderBy(desc(operationRetention.version))
          .limit(1);
        if ((current?.version ?? 0) !== policy.expectedVersion)
          throw new ApplicationError("CONFLICT");
        await tx.insert(operationRetention).values({
          id: randomUUID(),
          version: policy.expectedVersion + 1,
          policy,
          actorId: identity.userId,
        });
      });
    },
    diagnostics(identity: WorkIdentity) {
      return access(identity, "", true, async (tx) =>
        (
          await tx
            .select({
              id: operationDetail.id,
              eventId: operationDetail.eventId,
              kind: operationDetail.kind,
              requestId: operationDetail.requestId,
              code: operationDetail.code,
              expiresAt: operationDetail.expiresAt,
            })
            .from(operationDetail)
            .orderBy(desc(operationDetail.expiresAt))
            .limit(200)
        ).map((d) => ({ ...d, expiresAt: d.expiresAt.toISOString() })),
      );
    },
    prune(identity: WorkIdentity) {
      return access(identity, "", true, async (tx) => {
        const result = await tx.execute<{ deleted: number }>(
          sql`select public.prune_operation_details() as deleted`,
        );
        return { deleted: result.rows[0].deleted };
      });
    },
    mailboxWork(identity: WorkIdentity, businessId: string, jobId: string) {
      return access(identity, businessId, true, async (tx) => {
        const result = await tx.execute<{ work: unknown }>(
          sql`select public.operation_mailbox_work(${businessId}::uuid,${jobId}::uuid) as work`,
        );
        if (!result.rows[0]?.work) throw new ApplicationError("CONFLICT");
        return mailboxWorkSchema.parse(result.rows[0].work);
      });
    },
    async read(
      identity: WorkIdentity,
      businessId: string,
      operator: boolean,
      query: OperationQuery,
    ) {
      return access(identity, businessId, operator, async (tx) => {
        const scope = businessId
          ? eq(operationEvent.businessId, businessId)
          : undefined;
        const rows = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              scope,
              query.before
                ? lt(operationEvent.position, query.before)
                : undefined,
            ),
          )
          .orderBy(desc(operationEvent.position))
          .limit(query.limit + 1);
        const latest = await tx
          .selectDistinctOn([operationEvent.source, operationEvent.targetId])
          .from(operationEvent)
          .where(and(scope, eq(operationEvent.outcome, "observed")))
          .orderBy(
            operationEvent.source,
            operationEvent.targetId,
            desc(operationEvent.position),
          );
        const alerts = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              scope,
              sql`(${operationEvent.outcome}='escalated' or (${operationEvent.outcome}='observed' and (${operationEvent.snapshot}->>'reason' IS NOT NULL OR ${operationEvent.snapshot}->>'status' IN ('blocked','failed','ambiguous','handoff','incident','review'))))`,
            ),
          )
          .orderBy(desc(operationEvent.position))
          .limit(200);
        const acknowledgements = await tx
          .select()
          .from(operationEvent)
          .where(and(scope, eq(operationEvent.outcome, "acknowledged")));
        const handoffs = operator
          ? []
          : await tx
              .select({
                id: inboxOpportunity.id,
                ownerId: inboxOpportunity.ownerId,
                reason: inboxOpportunity.handoffReason,
                nextAction: inboxOpportunity.nextAction,
              })
              .from(inboxOpportunity)
              .where(eq(inboxOpportunity.businessId, businessId));
        return {
          history: rows.slice(0, query.limit).map(view),
          nextHistoryBefore:
            rows.length > query.limit ? rows[query.limit - 1].position : null,
          latest: latest.map(view),
          alerts: alerts.map(view),
          acknowledgements: acknowledgements.map(view),
          handoffs,
        };
      });
    },
    async begin(
      identity: WorkIdentity,
      businessId: string,
      command: RecoveryCommand,
      operator: boolean,
    ) {
      return access(identity, businessId, operator, async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`operations:${businessId}:${command.requestKey}`},0))`,
        );
        const previous = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              eq(operationEvent.businessId, businessId),
              eq(operationEvent.requestKey, command.requestKey),
            ),
          )
          .orderBy(desc(operationEvent.position));
        if (previous.length) {
          const saved = previous[0];
          if (
            saved.source !== command.source ||
            saved.targetId !== command.targetId ||
            saved.action !== command.action ||
            saved.actorId !== identity.userId
          )
            throw new ApplicationError("CONFLICT");
          return { replay: true, event: view(saved) };
        }
        const [target] = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              eq(operationEvent.businessId, businessId),
              eq(operationEvent.source, command.source),
              eq(operationEvent.targetId, command.targetId),
              eq(operationEvent.outcome, "observed"),
            ),
          )
          .orderBy(desc(operationEvent.position))
          .limit(1);
        if (!target) throw new ApplicationError("NOT_FOUND");
        if (
          !operator &&
          command.action !== "escalate" &&
          command.source === "queue"
        )
          await requireCapability(tx, identity, businessId, "profile.manage");
        const [proof] = await tx
          .select({ mfaAt: session.mfaVerifiedAt })
          .from(session)
          .where(
            and(
              eq(session.id, identity.sessionId),
              eq(session.userId, identity.userId),
            ),
          );
        if (!proof) throw new ApplicationError("UNAUTHENTICATED");
        const recoveryRole = operator
          ? "operations"
          : await requireCapability(tx, identity, businessId, "sales.work");
        const [event] = await tx
          .insert(operationEvent)
          .values({
            id: randomUUID(),
            businessId,
            source: command.source,
            targetId: command.targetId,
            snapshot: {
              ...target.snapshot,
              context: {
                ...target.snapshot.context,
                recoveryAuthority: operator
                  ? "operations.manage"
                  : "sales.work",
                recoveryRole,
                recoveryMfaAt: proof.mfaAt?.toISOString() ?? null,
              },
            },
            actorId: identity.userId,
            action: command.action,
            outcome: "requested",
            requestKey: command.requestKey,
          })
          .returning();
        return { replay: false, event: view(event) };
      });
    },
    async finish(
      identity: WorkIdentity,
      businessId: string,
      command: RecoveryCommand,
      operator: boolean,
      outcome: "queued" | "checked" | "escalated" | "blocked" | "unavailable",
    ) {
      return access(identity, businessId, operator, async (tx) => {
        const [started] = await tx
          .select()
          .from(operationEvent)
          .where(
            and(
              eq(operationEvent.businessId, businessId),
              eq(operationEvent.requestKey, command.requestKey),
              eq(operationEvent.outcome, "requested"),
            ),
          );
        if (!started || started.actorId !== identity.userId)
          throw new ApplicationError("FORBIDDEN");
        const [result] = await tx
          .insert(operationEvent)
          .values({
            ...started,
            id: randomUUID(),
            position: undefined,
            at: undefined,
            outcome,
          })
          .onConflictDoNothing()
          .returning();
        if (result)
          await tx.execute(
            sql`select public.record_operation_detail(${result.id}::uuid,${outcome === "blocked" ? "diagnostic" : "audit"},${command.requestKey}::uuid,${`RECOVERY_${outcome.toUpperCase()}`})`,
          );
        return result ? view(result) : view(started);
      });
    },
  };
}
