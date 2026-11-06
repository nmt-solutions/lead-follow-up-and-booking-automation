import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  requireSalesSession,
  writeControl,
} from "./opportunity-control-repository";
import {
  callActivity,
  callRevision,
  inboxOpportunity,
  inboxBuyer,
  user,
} from "./schema";
import { ApplicationError } from "../models/application-error";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import {
  callMemberSchema,
  type CallWorkspace,
  type SaveCall,
} from "../models/calls";

async function readOpportunityContext(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
) {
  const [opportunityContext] = await tx
    .select({ need: inboxOpportunity, buyer: inboxBuyer })
    .from(inboxOpportunity)
    .innerJoin(
      inboxBuyer,
      and(
        eq(inboxBuyer.id, inboxOpportunity.buyerId),
        eq(inboxBuyer.businessId, inboxOpportunity.businessId),
      ),
    )
    .where(
      and(
        eq(inboxOpportunity.businessId, businessId),
        eq(inboxOpportunity.id, opportunityId),
      ),
    );
  if (!opportunityContext) throw new ApplicationError("NOT_FOUND");
  return opportunityContext;
}
async function workspace(
  tx: Transaction,
  actor: WorkIdentity,
  businessId: string,
  opportunityContext: Awaited<ReturnType<typeof readOpportunityContext>>,
): Promise<CallWorkspace> {
  const result = await tx.execute(
    sql`select * from public.call_responsible_members()`,
  );
  const members = z.array(callMemberSchema).parse(result.rows);
  const rows = await tx
    .select({ activity: callActivity, revision: callRevision })
    .from(callRevision)
    .innerJoin(
      callActivity,
      and(
        eq(callActivity.id, callRevision.callId),
        eq(callActivity.businessId, callRevision.businessId),
      ),
    )
    .where(
      and(
        eq(callRevision.businessId, businessId),
        eq(callRevision.opportunityId, opportunityContext.need.id),
      ),
    )
    .orderBy(
      asc(callRevision.at),
      asc(callRevision.callId),
      asc(callRevision.version),
    );
  const history = rows.map(({ activity, revision }) => ({
    id: activity.id,
    revisionId: revision.id,
    buyerId: activity.buyerId,
    opportunityId: activity.opportunityId,
    version: revision.version,
    actorId: revision.actorId,
    actorName: revision.actorName,
    at: revision.at.toISOString(),
    occurredAt: revision.occurredAt.toISOString(),
    notes: revision.notes,
    outcome: revision.outcome,
    responsibleId: revision.responsibleId,
    responsibleName: revision.responsibleName,
    nextAction: revision.nextAction,
    recordedBy: activity.actorId,
    recordedByName: activity.actorName,
    recordedAt: activity.createdAt.toISOString(),
  }));
  const current = new Map<string, (typeof history)[number]>();
  for (const revision of history) {
    if (revision.version > (current.get(revision.id)?.version ?? 0))
      current.set(revision.id, revision);
  }
  const calls = [...current.values()].sort(
    (a, b) =>
      b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id),
  );
  return {
    buyerId: opportunityContext.buyer.id,
    buyerName: opportunityContext.buyer.name,
    opportunityId: opportunityContext.need.id,
    opportunityTitle: opportunityContext.need.title,
    actorId: actor.userId,
    controlVersion: opportunityContext.need.controlVersion,
    members,
    calls,
    history,
    callCount: calls.length,
  };
}

/** Append-only call identity/revisions under the same Business lock as ownership and dispatch.
 * Each command rechecks current persisted role, session and MFA before returning or changing state.
 */
export function createCallRepository(database: Database, clock: Clock) {
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx);
      },
      { lock: true },
    );
  }
  return {
    read(actor: WorkIdentity, businessId: string, opportunityId: string) {
      return scope(actor, businessId, async (tx) =>
        workspace(
          tx,
          actor,
          businessId,
          await readOpportunityContext(tx, businessId, opportunityId),
        ),
      );
    },
    save(
      actor: WorkIdentity,
      businessId: string,
      opportunityId: string,
      input: SaveCall,
    ) {
      return scope(actor, businessId, async (tx) => {
        const opportunityContext = await readOpportunityContext(
          tx,
          businessId,
          opportunityId,
        );
        if (input.buyerId !== opportunityContext.buyer.id)
          throw new ApplicationError("NOT_FOUND");
        const state = await workspace(
          tx,
          actor,
          businessId,
          opportunityContext,
        );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ opportunityId, input }))
          .digest("hex");
        const [replay] = await tx
          .select()
          .from(callRevision)
          .where(
            and(
              eq(callRevision.businessId, businessId),
              eq(callRevision.requestKey, input.requestKey),
            ),
          );
        if (replay) {
          if (
            replay.actorId !== actor.userId ||
            replay.fingerprint !== fingerprint
          )
            throw new ApplicationError("CONFLICT");
          return state;
        }
        const previous = input.callId
          ? state.calls.find((r) => r.id === input.callId)
          : null;
        if (input.callId && !previous) throw new ApplicationError("NOT_FOUND");
        if (
          input.expectedVersion !== (previous?.version ?? 0) ||
          input.expectedControlVersion !== state.controlVersion
        )
          throw new ApplicationError("CONFLICT");
        const responsible = state.members.find(
          (m) => m.userId === input.responsibleId,
        );
        const at = clock.now();
        if (!responsible || new Date(input.occurredAt) > at)
          throw new ApplicationError("INVALID_INPUT");
        const [recorder] = await tx
          .select({
            name: sql<string>`coalesce(nullif(${user.name}, ''), ${user.email})`,
          })
          .from(user)
          .where(eq(user.id, actor.userId));
        if (!recorder) throw new ApplicationError("UNAUTHENTICATED");
        const id = previous?.id ?? randomUUID();
        if (!previous)
          await tx.insert(callActivity).values({
            id,
            businessId,
            opportunityId,
            buyerId: opportunityContext.buyer.id,
            actorId: actor.userId,
            actorName: recorder.name,
            createdAt: at,
          });
        const revisionId = randomUUID();
        await tx.insert(callRevision).values({
          id: revisionId,
          businessId,
          callId: id,
          opportunityId,
          buyerId: opportunityContext.buyer.id,
          version: input.expectedVersion + 1,
          requestKey: input.requestKey,
          fingerprint,
          actorId: actor.userId,
          actorName: recorder.name,
          responsibleId: responsible.userId,
          responsibleName: responsible.name,
          occurredAt: new Date(input.occurredAt),
          notes: input.notes,
          outcome: input.outcome,
          nextAction: input.nextAction,
          at,
        });
        await writeControl(
          tx,
          actor,
          businessId,
          opportunityContext.need,
          { reason: "Human call logged", nextAction: input.nextAction },
          "takeover",
          at,
          null,
          revisionId,
        );
        return workspace(
          tx,
          actor,
          businessId,
          await readOpportunityContext(tx, businessId, opportunityId),
        );
      });
    },
  };
}
