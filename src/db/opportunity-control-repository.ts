import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, or } from "drizzle-orm";
import type { OpportunityRepository } from "../application/opportunity-control";
import { ApplicationError } from "../models/application-error";
import { hasMfa } from "../auth/access";
import type { BusinessRole } from "../models/team";
import type { WorkIdentity } from "../models/discovery";
import type { Clock } from "../models/business";
import type { Actor } from "../models/business";
import {
  commercialActions,
  evaluateCommercialAuthority,
} from "../models/commercial-authority";
import type {
  ControlChange,
  ControlHistory,
  ControlSnapshot,
  DueAction,
  PolicyReview,
} from "../models/opportunity-control";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { readCommercialPolicy } from "./commercial-authority-repository";
import {
  membership,
  session,
  user,
  inboxOpportunity,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxConnection,
  opportunityControlHistory,
  opportunityManualEvent,
  opportunityDueAction,
} from "./schema";

// Recheck persisted session/factor on this same transaction connection. No nested
// authentication transaction while holding the dispatch lock (which could exhaust the pool).
async function requireSalesSession(
  tx: Transaction,
  identity: WorkIdentity,
  at: Date,
  role: BusinessRole,
) {
  const [current] = await tx
    .select({
      token: session.token,
      expiresAt: session.expiresAt,
      enrolled: user.twoFactorEnabled,
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(
        eq(session.id, identity.sessionId),
        eq(session.userId, identity.userId),
      ),
    );
  if (!current || current.expiresAt <= at)
    throw new ApplicationError("UNAUTHENTICATED");
  if (
    (role !== "salesperson" || current.enrolled) &&
    !(await hasMfa(tx, current.token, at))
  )
    throw new ApplicationError("MFA_REQUIRED");
}
type Need = typeof inboxOpportunity.$inferSelect;
type Action = typeof opportunityDueAction.$inferSelect;
function snapshot(row: Need): ControlSnapshot {
  return {
    state: row.controlState,
    version: row.controlVersion,
    ownerId: row.ownerId,
    reason: row.handoffReason,
    nextAction: row.nextAction,
    policyVersion: row.policyVersion,
  };
}
function actionView(row: Action): DueAction {
  return {
    id: row.id,
    state: row.state,
    reason: row.reason,
    dueAt: row.dueAt.toISOString(),
  };
}
async function boundedDispatch(
  operation: (signal: AbortSignal) => Promise<void>,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ApplicationError("PROVIDER_UNAVAILABLE"));
        }, 5000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function needAt(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(inboxOpportunity)
    .where(
      and(
        eq(inboxOpportunity.businessId, businessId),
        eq(inboxOpportunity.id, id),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
async function messageContext(
  tx: Transaction,
  businessId: string,
  messageId: string,
) {
  const [row] = await tx
    .select({
      message: inboxMessage,
      link: inboxMessageLink,
      association: inboxAssociation,
      connection: inboxConnection,
    })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .innerJoin(
      inboxAssociation,
      eq(inboxMessage.conversationId, inboxAssociation.id),
    )
    .innerJoin(
      inboxConnection,
      eq(inboxMessage.connectionId, inboxConnection.id),
    )
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessage.id, messageId),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
async function reviewPolicy(
  tx: Transaction,
  businessId: string,
  at: Date,
): Promise<PolicyReview> {
  const policy = await readCommercialPolicy(tx, businessId, false);
  const connections = await tx
    .select()
    .from(inboxConnection)
    .where(
      and(
        eq(inboxConnection.businessId, businessId),
        eq(inboxConnection.active, true),
      ),
    );
  return {
    version: policy.version,
    decisions: Object.fromEntries(
      commercialActions.map((action) => [
        action,
        evaluateCommercialAuthority(
          policy,
          { action, amount: null, discountBps: null },
          at,
        ).reason,
      ]),
    ),
    activeConnections: connections.length,
  };
}
async function writeControl(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  need: Need,
  input: Pick<ControlChange, "reason" | "nextAction">,
  command: ControlHistory["command"],
  at: Date,
  policy: PolicyReview | null = null,
  sourceRef: string | null = null,
) {
  const before = snapshot(need);
  const after: ControlSnapshot = {
    state: command === "handback" ? "automation" : "human",
    version: before.version + 1,
    ownerId:
      command === "update" || command === "handback"
        ? before.ownerId
        : actor.userId,
    reason: input.reason,
    nextAction: input.nextAction,
    policyVersion: policy?.version ?? before.policyVersion,
  };
  await tx
    .update(inboxOpportunity)
    .set({
      controlState: after.state,
      controlVersion: after.version,
      ownerId: after.ownerId,
      handoffReason: after.reason,
      nextAction: after.nextAction,
      policyVersion: after.policyVersion,
    })
    .where(
      and(
        eq(inboxOpportunity.id, need.id),
        eq(inboxOpportunity.businessId, businessId),
      ),
    );
  await tx.insert(opportunityControlHistory).values({
    id: randomUUID(),
    opportunityId: need.id,
    businessId,
    command,
    actorId: actor.userId,
    before,
    after,
    sourceRef,
    policy,
    at,
  });
  // A new control generation never revives any previously queued action.
  await tx
    .update(opportunityDueAction)
    .set({ state: "cancelled", reason: "control_changed" })
    .where(
      and(
        eq(opportunityDueAction.businessId, businessId),
        eq(opportunityDueAction.opportunityId, need.id),
        eq(opportunityDueAction.state, "pending"),
      ),
    );
}

export function createOpportunityRepository(
  database: Database,
  clock: Clock,
): OpportunityRepository {
  return {
    read(actor, businessId, id) {
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
          const need = await needAt(tx, businessId, id);
          const history = await tx
            .select()
            .from(opportunityControlHistory)
            .where(
              and(
                eq(opportunityControlHistory.businessId, businessId),
                eq(opportunityControlHistory.opportunityId, id),
              ),
            )
            .orderBy(
              asc(opportunityControlHistory.at),
              asc(opportunityControlHistory.id),
            );
          history.sort((a, b) => a.after.version - b.after.version);
          const actions = await tx
            .select()
            .from(opportunityDueAction)
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.opportunityId, id),
              ),
            )
            .orderBy(
              asc(opportunityDueAction.createdAt),
              asc(opportunityDueAction.id),
            );
          const [owner] = need.ownerId
            ? await tx
                .select({ name: user.name })
                .from(user)
                .where(eq(user.id, need.ownerId))
            : [];
          return {
            id,
            ownerName: owner?.name ?? need.ownerId,
            ...snapshot(need),
            history: history.map((row) => ({
              ...row,
              at: row.at.toISOString(),
            })),
            actions: actions.map(actionView),
          };
        },
        { lock: true },
      );
    },
    change(actor, businessId, id, input, at) {
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
          const need = await needAt(tx, businessId, id);
          if (need.controlVersion !== input.expectedVersion)
            throw new ApplicationError("CONFLICT");
          if (
            input.command !== "takeover" &&
            need.ownerId !== actor.userId &&
            role === "salesperson"
          )
            throw new ApplicationError("FORBIDDEN");
          if (input.command === "update" && need.controlState !== "human")
            throw new ApplicationError("CONFLICT");
          if (input.command === "handback") {
            const [owner] = await tx
              .select({ id: membership.userId })
              .from(membership)
              .where(
                and(
                  eq(membership.businessId, businessId),
                  eq(membership.userId, need.ownerId ?? ""),
                ),
              );
            if (!owner) throw new ApplicationError("CONFLICT");
          }
          // Handback permits new evaluations only. Missing information/disabled authority remains blocked at dispatch.
          const policy =
            input.command === "handback"
              ? await reviewPolicy(tx, businessId, at)
              : null;
          await writeControl(
            tx,
            actor,
            businessId,
            need,
            input,
            input.command,
            at,
            policy,
          );
        },
        { lock: true },
      );
    },
    manualReply(actor, businessId, connectionId, input, at) {
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
          const [connection] = await tx
            .select()
            .from(inboxConnection)
            .where(
              and(
                eq(inboxConnection.id, connectionId),
                eq(inboxConnection.businessId, businessId),
              ),
            );
          if (!connection) throw new ApplicationError("NOT_FOUND");
          if (
            !connection.active ||
            !connection.manualRepliesObservable ||
            new Date(input.occurredAt) < connection.createdAt ||
            (connection.conversationRefs.length &&
              !connection.conversationRefs.includes(input.conversationRef))
          )
            throw new ApplicationError("FORBIDDEN");
          const { eventId, ...message } = input;
          const fingerprint = createHash("sha256")
            .update(JSON.stringify({ actorId: actor.userId, ...message }))
            .digest("hex");
          const seen = await tx
            .select()
            .from(opportunityManualEvent)
            .where(
              and(
                eq(opportunityManualEvent.businessId, businessId),
                eq(opportunityManualEvent.connectionId, connectionId),
                or(
                  eq(opportunityManualEvent.eventRef, eventId),
                  eq(opportunityManualEvent.messageRef, input.messageRef),
                ),
              ),
            );
          if (seen.length) {
            if (
              seen.some(
                (row) =>
                  row.fingerprint !== fingerprint ||
                  row.messageRef !== input.messageRef,
              )
            )
              throw new ApplicationError("CONFLICT");
            return {
              status: "duplicate",
              opportunityId: seen[0].opportunityId,
            };
          }
          const [original] = await tx
            .select()
            .from(inboxMessage)
            .where(
              and(
                eq(inboxMessage.businessId, businessId),
                eq(inboxMessage.connectionId, connectionId),
                eq(inboxMessage.messageRef, input.replyToMessageRef),
              ),
            );
          if (
            !original ||
            original.content.conversationRef !== input.conversationRef
          )
            throw new ApplicationError("NOT_FOUND");
          const ctx = await messageContext(tx, businessId, original.id);
          if (!ctx.link.opportunityId) throw new ApplicationError("CONFLICT");
          const need = await needAt(tx, businessId, ctx.link.opportunityId);
          await writeControl(
            tx,
            actor,
            businessId,
            need,
            input,
            "manual_reply",
            at,
            null,
            input.eventId,
          );
          await tx.insert(opportunityManualEvent).values({
            id: randomUUID(),
            businessId,
            connectionId,
            opportunityId: need.id,
            actorId: actor.userId,
            eventRef: eventId,
            messageRef: input.messageRef,
            fingerprint,
            occurredAt: new Date(input.occurredAt),
            at,
          });
          return { status: "captured", opportunityId: need.id };
        },
        { lock: true },
      );
    },
    queue(identity, businessId, id, input, at) {
      return scoped(
        database,
        identity,
        businessId,
        async (tx) => {
          const role = await requireCapability(
            tx,
            identity,
            businessId,
            "sales.work",
          );
          await requireSalesSession(tx, identity, clock.now(), role);
          const need = await needAt(tx, businessId, id);
          if (
            need.controlState !== "automation" ||
            need.ownerId !== identity.userId
          )
            throw new ApplicationError("CONFLICT");
          const ctx = await messageContext(tx, businessId, input.messageId);
          if (ctx.link.opportunityId !== id || !ctx.connection.active)
            throw new ApplicationError("CONFLICT");
          const policy = await readCommercialPolicy(tx, businessId, false);
          const [row] = await tx
            .insert(opportunityDueAction)
            .values({
              id: randomUUID(),
              businessId,
              opportunityId: id,
              messageId: input.messageId,
              connectionId: ctx.connection.id,
              conversationId: ctx.association.id,
              actorId: identity.userId,
              sessionId: identity.sessionId,
              controlVersion: need.controlVersion,
              associationVersion: ctx.association.version,
              policyVersion: policy.version,
              evaluation: input.evaluation,
              state: "pending",
              dueAt: new Date(input.dueAt),
              createdAt: at,
            })
            .returning();
          return actionView(row);
        },
        { lock: true },
      );
    },
    async dispatch(actor, businessId, actionId, now, provider) {
      async function cancel(tx: Transaction, reason: string) {
        const [cancelled] = await tx
          .update(opportunityDueAction)
          .set({ state: "cancelled", reason })
          .where(
            and(
              eq(opportunityDueAction.id, actionId),
              eq(opportunityDueAction.businessId, businessId),
            ),
          )
          .returning();
        return cancelled;
      }
      async function sessionFailure(
        tx: Transaction,
        action: Action,
        role: BusinessRole,
      ) {
        try {
          await requireSalesSession(tx, actor, now(), role);
          if (action.sessionId !== actor.sessionId)
            await requireSalesSession(
              tx,
              { userId: action.actorId, sessionId: action.sessionId },
              now(),
              role,
            );
          return null;
        } catch (error: unknown) {
          if (
            error instanceof ApplicationError &&
            (error.code === "UNAUTHENTICATED" || error.code === "MFA_REQUIRED")
          )
            return error;
          throw error;
        }
      }
      const claim = await scoped(
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
          await requireSalesSession(tx, actor, now(), role);
          const [row] = await tx
            .select()
            .from(opportunityDueAction)
            .where(
              and(
                eq(opportunityDueAction.id, actionId),
                eq(opportunityDueAction.businessId, businessId),
              ),
            );
          if (!row) throw new ApplicationError("NOT_FOUND");
          if (row.actorId !== actor.userId)
            throw new ApplicationError("FORBIDDEN");
          if (row.state !== "pending" || row.dueAt > now())
            return { action: row, acquired: false, failure: null };
          const failure = await sessionFailure(tx, row, role);
          if (failure)
            return {
              action: await cancel(tx, "authorization_revoked"),
              acquired: false,
              failure,
            };
          const ctx = await messageContext(tx, businessId, row.messageId);
          if (!provider.channels.includes(ctx.connection.channel))
            throw new ApplicationError("SETUP_REQUIRED");
          // Durable commitment prevents retries after a timeout/crash following an external effect.
          // Unconfirmed includes a crash before the adapter starts; it is never proof of sending.
          const [committed] = await tx
            .update(opportunityDueAction)
            .set({ state: "committed", reason: "dispatch_unconfirmed" })
            .where(eq(opportunityDueAction.id, actionId))
            .returning();
          return { action: committed, acquired: true, failure: null };
        },
        { lock: true },
      );
      if (claim.failure) throw claim.failure;
      const { action } = claim;
      if (!claim.acquired) return actionView(action);
      // Only the invocation that transitions pending -> committed may call the provider.
      const result = await scoped(
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
          const failure = await sessionFailure(tx, action, role);
          if (failure)
            return {
              action: await cancel(tx, "authorization_revoked"),
              failure,
            };
          const need = await needAt(tx, businessId, action.opportunityId);
          const ctx = await messageContext(tx, businessId, action.messageId);
          const policy = await readCommercialPolicy(tx, businessId, false);
          const decision = evaluateCommercialAuthority(
            policy,
            action.evaluation,
            now(),
          );
          const reason =
            need.controlState !== "automation" ||
            need.controlVersion !== action.controlVersion ||
            need.ownerId !== action.actorId
              ? "control_changed"
              : ctx.association.version !== action.associationVersion ||
                  ctx.link.opportunityId !== need.id
                ? "association_changed"
                : !ctx.connection.active
                  ? "connection_revoked"
                  : policy.version !== action.policyVersion
                    ? "policy_changed"
                    : decision.status !== "permitted"
                      ? decision.reason
                      : null;
          if (reason)
            return { action: await cancel(tx, reason), failure: null };
          // Reviewed exception to external-I/O-outside-transactions: the shared lock is held
          // through bounded adapter I/O, so a committed pause cannot precede a stale send.
          // Policy/team/connection changes use this same lock. Providers must never retry here.
          await boundedDispatch((signal) =>
            provider.dispatch(
              {
                actionId,
                businessId,
                opportunityId: need.id,
                connectionId: ctx.connection.id,
                channel: ctx.connection.channel,
                evaluation: action.evaluation,
              },
              signal,
            ),
          );
          const [sent] = await tx
            .update(opportunityDueAction)
            .set({ state: "dispatched", reason: null })
            .where(eq(opportunityDueAction.id, actionId))
            .returning();
          return { action: sent, failure: null };
        },
        { lock: true },
      );
      // Throw after committing a known pre-provider cancellation, so it stays visible on reload.
      if (result.failure) throw result.failure;
      return actionView(result.action);
    },
  };
}
