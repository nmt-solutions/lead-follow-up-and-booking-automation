import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  evaluateEmailAction,
  emailDecisionAtDispatch,
} from "./email-eligibility-context";
import { emailDispatchAuthorization } from "../models/email-eligibility";
import { and, asc, eq, or } from "drizzle-orm";
import type { OpportunityRepository } from "../application/opportunity-control";
import { ApplicationError } from "../models/application-error";
import { requireSalesSession } from "./sales-session";
export { requireSalesSession } from "./sales-session";
import type { BusinessRole } from "../models/team";
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
  OpportunityDispatch,
} from "../models/opportunity-control";
import type { OpportunityMailEnvelope } from "../models/opportunity-mail";
import { mailResultSchema } from "../models/mail-dispatch";
import { gmailSequenceKey } from "../gmail/sequence-mail";
import { gmailDispatchAccess } from "./gmail-dispatch";
import { reconciledOpportunityMail } from "./opportunity-mail";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { inquiryDispatchContext, lockInquiryProfile } from "./inquiry-context";
import { responseSender, responseSenderUse } from "./sender-repository";
import {
  mailboxMessageAllowed,
  opportunityRepliesVisible,
} from "./mailbox-processing";
import { committedFollowupStopReason } from "./opportunity-followups";
import {
  membership,
  user,
  inboxOpportunity,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxConnection,
  opportunityControlHistory,
  opportunityManualEvent,
  opportunityDueAction,
  emailSequenceAction,
  senderIdentity,
  mailboxPolicy,
} from "./schema";

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
    email: row.email
      ? { result: row.email.result, sent: row.email.sent }
      : null,
  };
}
async function boundedDispatch<T>(
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
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
export async function writeControl(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  need: Need,
  input: Pick<ControlChange, "reason" | "nextAction">,
  command: ControlHistory["command"],
  at: Date,
  policy: PolicyReview | null = null,
  sourceRef: string | null = null,
  ownerId?: string,
) {
  const before = snapshot(need);
  const after: ControlSnapshot = {
    state: command === "handback" ? "automation" : "human",
    version: before.version + 1,
    ownerId:
      ownerId ??
      (command === "update" || command === "handback"
        ? before.ownerId
        : actor.userId),
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
  if (command !== "handback")
    await tx
      .update(emailSequenceAction)
      .set({ state: "paused", reason: "human_control", queueState: "none" })
      .where(
        and(
          eq(emailSequenceAction.businessId, businessId),
          eq(emailSequenceAction.opportunityId, need.id),
          or(
            eq(emailSequenceAction.state, "pending"),
            eq(emailSequenceAction.state, "waiting"),
          ),
        ),
      );
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

function sameMailIntent(
  a: OpportunityMailEnvelope,
  b: OpportunityMailEnvelope,
) {
  return isDeepStrictEqual(a, b);
}

export function createOpportunityRepository(
  database: Database,
  clock: Clock,
): OpportunityRepository {
  return {
    reconcile(actor, businessId, actionId) {
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
          const [row] = await tx
            .select()
            .from(opportunityDueAction)
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            );
          if (!row) throw new ApplicationError("NOT_FOUND");
          if (row.actorId !== actor.userId)
            throw new ApplicationError("FORBIDDEN");
          if (!["committed", "dispatched"].includes(row.state))
            return actionView(row);
          const email = await reconciledOpportunityMail(tx, row, clock.now());
          if (!email) return actionView(row);
          const [updated] = await tx
            .update(opportunityDueAction)
            .set({ email, state: "dispatched", reason: null })
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            )
            .returning();
          return actionView(updated);
        },
        { lock: true },
      );
    },
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
            title: need.title,
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
      async function authorize(
        tx: Transaction,
        action: Action,
        role: BusinessRole,
        intentOnly = false,
      ) {
        const failure = await sessionFailure(tx, action, role);
        if (failure)
          return { action: await cancel(tx, "authorization_revoked"), failure };
        const stopped = committedFollowupStopReason(action.reason);
        if (stopped)
          return { action: await cancel(tx, stopped), failure: null };
        const need = await needAt(tx, businessId, action.opportunityId);
        const ctx = await messageContext(tx, businessId, action.messageId);
        if (action.inquiryRunId && !intentOnly) await lockInquiryProfile(tx);
        const inquiry = action.inquiryRunId
          ? await inquiryDispatchContext(
              tx,
              businessId,
              action.inquiryRunId,
              need.id,
              clock.now(),
            )
          : null;
        const policy = await readCommercialPolicy(tx, businessId, false);
        const decision = action.evaluation
          ? evaluateCommercialAuthority(policy, action.evaluation, now())
          : null;
        const mailboxAllowed = await mailboxMessageAllowed(
          tx,
          businessId,
          ctx.connection.id,
          ctx.message.mailboxMetadata,
          now(),
        );
        const replyVisible = await opportunityRepliesVisible(
          tx,
          businessId,
          need.id,
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
              : !mailboxAllowed
                ? "connection_revoked"
                : !replyVisible
                  ? "reply_visibility_unavailable"
                  : policy.version !== action.policyVersion
                    ? "policy_changed"
                    : (inquiry?.reason ??
                      (decision && decision.status !== "permitted"
                        ? decision.reason
                        : !decision && !inquiry
                          ? "missing_authority"
                          : null));
        if (reason) return { action: await cancel(tx, reason), failure: null };
        const sender =
          ctx.connection.channel === "email"
            ? await responseSender(
                tx,
                businessId,
                ctx.connection.id,
                now(),
                responseSenderUse(ctx.message),
              )
            : null;
        let eligibility =
          ctx.connection.channel === "email" && !intentOnly
            ? await evaluateEmailAction(
                tx,
                businessId,
                { kind: "opportunity", id: action.id },
                actor.userId,
                now(),
              )
            : null;
        if (sender?.reason)
          return { action: await cancel(tx, sender.reason), failure: null };
        if (
          sender?.sender &&
          (sender.sender.adapterKey !== provider.emailIdentity?.adapterKey ||
            sender.sender.mode !== provider.emailIdentity.mode)
        )
          return {
            action: await cancel(tx, "sender_transport_unavailable"),
            failure: null,
          };
        if (eligibility)
          eligibility = await emailDecisionAtDispatch(
            tx,
            businessId,
            actor.userId,
            eligibility,
            now(),
          );
        if (eligibility && eligibility.status !== "allowed")
          return {
            action: await cancel(tx, `email_eligibility_${eligibility.status}`),
            failure: null,
          };
        const dispatch: OpportunityDispatch = {
          actionId: action.id,
          businessId,
          opportunityId: need.id,
          connectionId: ctx.connection.id,
          channel: ctx.connection.channel,
          evaluation: action.evaluation,
          ...(eligibility
            ? { emailEligibility: emailDispatchAuthorization(eligibility) }
            : {}),
          ...(sender?.sender ? { sender: sender.sender } : {}),
          ...(inquiry?.reply ? { reply: inquiry.reply } : {}),
        };
        if (!provider.channels.includes(ctx.connection.channel))
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        let email: OpportunityMailEnvelope | undefined;
        if (
          provider.emailIdentity?.adapterKey === gmailSequenceKey &&
          ctx.connection.channel === "email"
        ) {
          const native = ctx.message.mailboxMetadata?.native;
          if (
            !inquiry?.reply ||
            !sender?.sender ||
            (!intentOnly && !eligibility) ||
            !native ||
            ctx.connection.mode !== "mailbox" ||
            native.direction !== "incoming" ||
            native.from !== inquiry.reply.recipientRef ||
            !native.to.includes(sender.sender.fromAddress)
          )
            return {
              action: await cancel(tx, "native_reply_context_required"),
              failure: null,
            };
          const [identity] = await tx
            .select()
            .from(senderIdentity)
            .where(
              and(
                eq(senderIdentity.businessId, businessId),
                eq(senderIdentity.id, sender.sender.identityId),
              ),
            );
          if (!identity?.configuration.connectionId)
            return {
              action: await cancel(tx, "sender_setup_required"),
              failure: null,
            };
          const [mailbox] = await tx
            .select()
            .from(mailboxPolicy)
            .where(
              and(
                eq(mailboxPolicy.businessId, businessId),
                eq(mailboxPolicy.id, ctx.connection.id),
              ),
            );
          if (
            mailbox?.provider !== "gmail" ||
            mailbox.connectionId !== identity.configuration.connectionId ||
            mailbox.account !== sender.sender.fromAddress
          )
            return {
              action: await cancel(tx, "native_reply_mailbox_mismatch"),
              failure: null,
            };
          email = {
            actionId: action.id,
            attemptId: action.id,
            businessId,
            opportunityId: need.id,
            adapterKey: sender.sender.adapterKey,
            adapterMode: "live",
            connectionId: identity.configuration.connectionId,
            mailboxId: ctx.connection.id,
            senderIdentityId: sender.sender.identityId,
            senderVersion: sender.sender.identityVersion,
            senderEvidenceId: sender.sender.evidenceId,
            messageId: ctx.message.id,
            reservedAt:
              action.email?.envelope.reservedAt ?? now().toISOString(),
            fromAddress: sender.sender.fromAddress,
            fromName: sender.sender.fromName,
            replyTo: sender.sender.replyTo,
            platformDisclosure: sender.sender.platformDisclosure,
            recipient: inquiry.reply.recipientRef,
            subject: ctx.message.content.subject,
            body: inquiry.reply.text,
            internetMessageId: `<inquiry-${action.id}@business-operations.invalid>`,
            parent: {
              messageRef: ctx.message.messageRef,
              threadRef: ctx.message.content.conversationRef,
              internetMessageId: native.internetMessageId,
            },
          };
          if (action.email && !sameMailIntent(action.email.envelope, email))
            return {
              action: await cancel(tx, "inquiry_context_changed"),
              failure: null,
            };
          dispatch.email = action.email?.envelope ?? email;
        }
        return { action, failure: null, dispatch, email };
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
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            );
          if (!row) throw new ApplicationError("NOT_FOUND");
          if (row.actorId !== actor.userId)
            throw new ApplicationError("FORBIDDEN");
          if (row.state !== "pending" || row.dueAt > now())
            return { action: row, acquired: false, failure: null };
          let email: OpportunityMailEnvelope | undefined;
          if (
            provider.emailIdentity?.adapterKey === gmailSequenceKey &&
            row.inquiryRunId
          ) {
            // Prepare the immutable reply intent without holding global policy/profile locks across commitment.
            // Full authorization belongs to the locked provider boundary below, and repeats after refresh.
            const allowed = await authorize(tx, row, role, true);
            if (!allowed.dispatch) return { ...allowed, acquired: false };
            email = allowed.email;
          } else {
            const failure = await sessionFailure(tx, row, role);
            if (failure)
              return {
                action: await cancel(tx, "authorization_revoked"),
                acquired: false,
                failure,
              };
            const ctx = await messageContext(tx, businessId, row.messageId);
            if (!provider.channels.includes(ctx.connection.channel))
              throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
          }
          // Commit the exact intent BEFORE transport. A crash or result-write failure cannot erase correlation.
          const [committed] = await tx
            .update(opportunityDueAction)
            .set({
              state: "committed",
              reason: "dispatch_unconfirmed",
              ...(email
                ? {
                    email: {
                      envelope: email,
                      result: null,
                      sent: null,
                    },
                  }
                : {}),
            })
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            )
            .returning();
          return { action: committed, acquired: true, failure: null };
        },
        { lock: true },
      );
      if (claim.failure) throw claim.failure;
      if (!claim.acquired) return actionView(claim.action);
      // Only this invocation owns the pending -> committed transition; replay never invokes transport.
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
          const [current] = await tx
            .select()
            .from(opportunityDueAction)
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            );
          if (!current) throw new ApplicationError("NOT_FOUND");
          if (current.state !== "committed")
            return { action: current, failure: null };
          const allowed = await authorize(tx, current, role);
          if (!allowed.dispatch) return allowed;
          let finalFailure: Awaited<ReturnType<typeof authorize>> | undefined;
          const access = current.email
            ? await gmailDispatchAccess(
                tx,
                current.email.envelope,
                null,
                current.email.envelope.subject,
                async () => {
                  // Refresh can consume time or change actual grants. Repeat ALL current-state guards under the same lock.
                  const refreshed = await authorize(tx, current, role);
                  if (!refreshed.dispatch) {
                    finalFailure = refreshed;
                    return false;
                  }
                  return true;
                },
                {
                  ...current.email.envelope.parent,
                  subject: current.email.envelope.subject,
                },
                () => clock.now(),
              )
            : undefined;
          let providerResult:
            void | import("../models/mail-dispatch").MailResult;
          try {
            providerResult = await boundedDispatch((signal) =>
              provider.dispatch(allowed.dispatch, signal, access),
            );
          } catch (error: unknown) {
            // Legacy providers retain their existing throw contract. Native mail failures remain visibly unknown.
            if (!current.email)
              return {
                action: current,
                failure: null,
                providerFailure: { error },
              };
            providerResult = { status: "unknown" };
          }
          if (finalFailure) return finalFailure;
          if (!current.email) {
            const [sent] = await tx
              .update(opportunityDueAction)
              .set({ state: "dispatched", reason: null })
              .where(eq(opportunityDueAction.id, actionId))
              .returning();
            return { action: sent, failure: null };
          }
          const parsed = mailResultSchema.safeParse(providerResult);
          let outcome = parsed.success
            ? parsed.data
            : { status: "unknown" as const };
          if (outcome.status === "accepted") {
            const e = current.email.envelope,
              r = outcome.receipt;
            if (
              r.actionId !== actionId ||
              r.attemptId !== actionId ||
              r.businessId !== businessId ||
              r.connectionId !== e.connectionId ||
              r.recipient !== e.recipient ||
              r.internetMessageId !== e.internetMessageId ||
              r.threadRef !== e.parent.threadRef ||
              r.evidence !== "provider_response" ||
              new Date(r.acceptedAt) < new Date(e.reservedAt) ||
              new Date(r.acceptedAt) > now()
            )
              outcome = { status: "unknown" };
          }
          const [settled] = await tx
            .update(opportunityDueAction)
            .set({
              state:
                outcome.status === "accepted"
                  ? "dispatched"
                  : outcome.status === "not_accepted"
                    ? "cancelled"
                    : "committed",
              reason:
                outcome.status === "accepted"
                  ? null
                  : outcome.status === "not_accepted"
                    ? `provider_${outcome.reason}`
                    : "dispatch_unconfirmed",
              email: { ...current.email, result: outcome },
            })
            .where(
              and(
                eq(opportunityDueAction.businessId, businessId),
                eq(opportunityDueAction.id, actionId),
              ),
            )
            .returning();
          return { action: settled, failure: null };
        },
        { lock: true },
      );
      if (result.failure) throw result.failure;
      if ("providerFailure" in result && result.providerFailure)
        throw result.providerFailure.error;
      return actionView(result.action);
    },
  };
}
