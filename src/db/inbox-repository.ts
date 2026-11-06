import type { MailboxMetadata } from "../models/mailboxes";
import { captureEmailOptOut } from "./email-opt-out";
import { explicitEmailOptOut } from "../inbox/opt-out";
import { resolveMailReference } from "./mailbox-reference";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { stopOpportunityFollowups } from "./opportunity-followups";
import { observeSequenceReply } from "./email-sequence-observations";
import type { InboxRepository } from "../application/inbox";
import { ApplicationError } from "../models/application-error";
import type { Actor } from "../models/business";
import type { CaptureResult, IncomingInquiry } from "../models/inbox";
import {
  connectionView,
  createAssociationRepository,
} from "./inbox-associations";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  inboxConnection,
  inboxBuyer,
  inboxConversation,
  inboxOpportunity,
  inboxMessage,
  inboxEvent,
  inboxAssociation,
  inboxMessageLink,
  inboxAssociationHistory,
} from "./schema";

async function requireConnection(
  tx: Transaction,
  businessId: string,
  id: string,
) {
  const [connection] = await tx
    .select()
    .from(inboxConnection)
    .where(
      and(
        eq(inboxConnection.id, id),
        eq(inboxConnection.businessId, businessId),
      ),
    );
  if (!connection) throw new ApplicationError("NOT_FOUND");
  if (!connection.active) throw new ApplicationError("FORBIDDEN");
  return connection;
}
function fingerprint(event: IncomingInquiry, includeEvent: boolean) {
  const { eventId, ...message } = event;
  return createHash("sha256")
    .update(JSON.stringify(includeEvent ? { eventId, ...message } : message))
    .digest("hex");
}

export function createInboxRepository(database: Database): InboxRepository {
  return {
    ...createAssociationRepository(database),
    addConnection(actor, businessId, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "integrations.manage");
          const [row] = await tx
            .insert(inboxConnection)
            .values({
              ...input,
              id: randomUUID(),
              businessId,
              active: true,
              createdBy: actor.userId,
              createdAt: at,
            })
            .returning();
          return connectionView(row);
        },
        { lock: true },
      );
    },
    revokeConnection(actor, businessId, id) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "integrations.manage");
          await requireConnection(tx, businessId, id);
          await tx
            .update(inboxConnection)
            .set({ active: false })
            .where(eq(inboxConnection.id, id));
        },
        { lock: true },
      );
    },
    intakeConnection(actor, businessId, id) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "integrations.manage");
        const row = await requireConnection(tx, businessId, id);
        if (row.mode !== "normalized_import")
          throw new ApplicationError("FORBIDDEN");
        return connectionView(row);
      });
    },
    capture(actor, businessId, connectionId, event, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          return captureInboxInquiry(
            tx,
            actor,
            businessId,
            connectionId,
            event,
            at,
          );
        },
        { lock: true },
      );
    },
  };
}

/** Shared atomic inbox ingestion. Mailbox authorization is supplied only by the policy-checked sync transaction. */
export async function captureInboxInquiry(
  tx: Transaction,
  actor: Actor,
  businessId: string,
  connectionId: string,
  event: IncomingInquiry,
  at: Date,
  authorization?: { since: Date; metadata: MailboxMetadata },
  metaAuthorization?: { connectionId: string },
): Promise<CaptureResult> {
  // Recheck after normalization; role/connection revocation can race adapter I/O.
  await requireCapability(tx, actor, businessId, "integrations.manage");
  const connection = await requireConnection(tx, businessId, connectionId);
  if (
    new Date(event.occurredAt) <
      (authorization?.since ?? connection.createdAt) ||
    (connection.conversationRefs.length &&
      !connection.conversationRefs.includes(event.conversationRef))
  )
    throw new ApplicationError("FORBIDDEN");
  if (connection.mode === "mailbox" && !authorization)
    throw new ApplicationError("FORBIDDEN");
  if (
    connection.mode === "meta" &&
    metaAuthorization?.connectionId !== connection.id
  )
    throw new ApplicationError("FORBIDDEN");
  const eventFingerprint = fingerprint(event, true);
  const [seen] = await tx
    .select()
    .from(inboxEvent)
    .where(
      and(
        eq(inboxEvent.connectionId, connectionId),
        eq(inboxEvent.eventRef, event.eventId),
      ),
    );
  if (seen) {
    if (seen.fingerprint !== eventFingerprint)
      throw new ApplicationError("CONFLICT");
    return { status: "duplicate", conversationId: seen.conversationId };
  }
  const recordEvent = async (conversationId: string | null) => {
    await tx.insert(inboxEvent).values({
      id: randomUUID(),
      businessId,
      connectionId,
      eventRef: event.eventId,
      fingerprint: eventFingerprint,
      conversationId,
      receivedAt: at,
    });
  };
  if (
    connection.channel === "email" &&
    event.kind !== "public_signal" &&
    (event.kind === "opt_out" || explicitEmailOptOut(event.text))
  ) {
    const result = await captureEmailOptOut(
      tx,
      businessId,
      connectionId,
      actor.userId,
      event,
      at,
      authorization?.metadata,
    );
    await recordEvent(result.conversationId);
    return result;
  }
  if (event.kind === "opt_out") throw new ApplicationError("INVALID_INPUT");
  const sequenceOpportunityId = await observeSequenceReply(
    tx,
    businessId,
    connectionId,
    actor.userId,
    event,
    at,
    authorization?.metadata,
  );
  if (event.kind === "public_signal" || event.kind === "other_reply") {
    await recordEvent(null);
    return { status: "ignored", conversationId: null };
  }
  const messageFingerprint = fingerprint(event, false);
  const [message] = await tx
    .select()
    .from(inboxMessage)
    .where(
      and(
        eq(inboxMessage.connectionId, connectionId),
        eq(inboxMessage.messageRef, event.messageRef),
      ),
    );
  if (message) {
    if (message.fingerprint !== messageFingerprint)
      throw new ApplicationError("CONFLICT");
    await recordEvent(message.conversationId);
    return {
      status: "duplicate",
      conversationId: message.conversationId,
    };
  }
  const [existingBuyer] = await tx
    .select()
    .from(inboxBuyer)
    .where(
      and(
        eq(inboxBuyer.connectionId, connectionId),
        eq(inboxBuyer.senderRef, event.senderRef),
      ),
    );
  const buyerId = existingBuyer?.id ?? randomUUID();
  if (!existingBuyer)
    await tx.insert(inboxBuyer).values({
      id: buyerId,
      businessId,
      connectionId,
      senderRef: event.senderRef,
      name: event.senderName,
      geography: event.geography,
      engagedAt: at,
    });
  const [conversation] = await tx
    .select()
    .from(inboxConversation)
    .where(
      and(
        eq(inboxConversation.connectionId, connectionId),
        eq(inboxConversation.providerRef, event.conversationRef),
      ),
    );
  if (conversation && conversation.buyerId !== buyerId)
    throw new ApplicationError("CONFLICT");
  const nativeReply = authorization?.metadata.native?.inReplyTo;
  const nativeReference =
    !event.replyToMessageRef && nativeReply
      ? await resolveMailReference(tx, businessId, connectionId, nativeReply, [
          event.senderRef.toLowerCase(),
        ])
      : null;
  const replies = event.replyToMessageRef
    ? await tx
        .select({
          opportunityId: inboxMessageLink.opportunityId,
          buyerId: inboxAssociation.buyerId,
          originalBuyerId: inboxConversation.buyerId,
        })
        .from(inboxMessage)
        .innerJoin(inboxMessageLink, eq(inboxMessageLink.id, inboxMessage.id))
        .innerJoin(
          inboxConversation,
          eq(inboxConversation.id, inboxMessage.conversationId),
        )
        .innerJoin(
          inboxAssociation,
          eq(inboxAssociation.id, inboxMessage.conversationId),
        )
        .where(
          and(
            eq(inboxMessage.businessId, businessId),
            eq(inboxMessage.connectionId, connectionId),
            event.replyToMessageRef
              ? eq(inboxMessage.messageRef, event.replyToMessageRef)
              : sql`${inboxMessage.mailboxMetadata}->'native'->>'internetMessageId' = ${nativeReply}`,
          ),
        )
    : nativeReference?.status === "resolved"
      ? [nativeReference]
      : [];
  const reply = replies.length === 1 ? replies[0] : undefined;
  // An exact channel identity and received reply reference establish continuity; names/domains never do.
  const verifiedReply =
    reply?.originalBuyerId === buyerId
      ? reply
      : sequenceOpportunityId
        ? {
            opportunityId: sequenceOpportunityId,
            buyerId,
            originalBuyerId: buyerId,
          }
        : undefined;
  if (sequenceOpportunityId)
    await tx
      .update(inboxOpportunity)
      .set({ buyerId, stage: "inquiry" })
      .where(
        and(
          eq(inboxOpportunity.businessId, businessId),
          eq(inboxOpportunity.id, sequenceOpportunityId),
          eq(inboxOpportunity.stage, "prospect"),
        ),
      );
  const effectiveBuyerId = verifiedReply?.buyerId ?? buyerId;
  const conversationId = conversation?.id ?? randomUUID();
  let [association] = await tx
    .select()
    .from(inboxAssociation)
    .where(
      and(
        eq(inboxAssociation.id, conversationId),
        eq(inboxAssociation.businessId, businessId),
      ),
    );
  if (!conversation) {
    await tx.insert(inboxConversation).values({
      id: conversationId,
      businessId,
      connectionId,
      buyerId,
      providerRef: event.conversationRef,
      subject: event.subject,
      lastReceivedAt: at,
    });
    const opportunityId = verifiedReply?.opportunityId ?? randomUUID();
    const [candidate] = await tx
      .select({ id: inboxOpportunity.id })
      .from(inboxOpportunity)
      .where(
        and(
          eq(inboxOpportunity.businessId, businessId),
          eq(inboxOpportunity.buyerId, effectiveBuyerId),
        ),
      )
      .limit(1);
    if (!verifiedReply?.opportunityId)
      await tx.insert(inboxOpportunity).values({
        id: opportunityId,
        businessId,
        buyerId: effectiveBuyerId,
        title: event.subject,
        connectionId,
        conversationId,
        stage: "inquiry",
        ownerId: null,
        handoffReason:
          "Human review required; intake grants no action authority",
        nextAction: "Review incoming inquiry",
        createdAt: at,
      });
    [association] = await tx
      .insert(inboxAssociation)
      .values({
        id: conversationId,
        businessId,
        buyerId: effectiveBuyerId,
        initialOpportunityId: opportunityId,
        defaultOpportunityId:
          verifiedReply && !verifiedReply.opportunityId ? null : opportunityId,
        version: 0,
        reviewReason:
          candidate && !verifiedReply
            ? "Buyer has other purchasing needs; compare before associating"
            : null,
        reviewOwnerId: actor.userId,
        nextAction:
          candidate && !verifiedReply
            ? "Compare this inquiry with the buyer's existing Opportunities; keep separate or explicitly associate"
            : "Review incoming inquiry",
      })
      .returning();
  } else {
    await tx
      .update(inboxConversation)
      .set({ lastReceivedAt: at })
      .where(eq(inboxConversation.id, conversationId));
  }
  if (!association) throw new ApplicationError("CONFLICT");
  let opportunityId =
    replies.length > 1 || nativeReference?.status === "ambiguous"
      ? null
      : association.defaultOpportunityId;
  if (reply)
    opportunityId =
      reply.buyerId === association.buyerId ? reply.opportunityId : null;
  const messageId = randomUUID();
  await tx.insert(inboxMessage).values({
    id: messageId,
    businessId,
    connectionId,
    conversationId,
    messageRef: event.messageRef,
    content: event,
    mailboxMetadata: authorization?.metadata ?? null,
    fingerprint: messageFingerprint,
    receivedAt: at,
  });
  await tx.insert(inboxMessageLink).values({
    id: messageId,
    businessId,
    conversationId,
    opportunityId,
    sequence: association.version + 1,
  });
  await tx
    .update(inboxAssociation)
    .set({
      version: association.version + 1,
      ...(!opportunityId
        ? {
            reviewReason: "Message has no unambiguous purchasing need",
            nextAction:
              "Review unassociated messages and choose or create a purchasing need",
          }
        : {}),
    })
    .where(
      and(
        eq(inboxAssociation.id, conversationId),
        eq(inboxAssociation.businessId, businessId),
      ),
    );
  await tx.insert(inboxAssociationHistory).values({
    id: randomUUID(),
    businessId,
    conversationId,
    actorId: actor.userId,
    sourceEventId: event.eventId,
    version: association.version + 1,
    reason: opportunityId
      ? "Intake used the explicit conversation default or matching reply association"
      : "Intake retained an ambiguous message for review",
    before: {
      buyerId: association.buyerId,
      defaultOpportunityId: association.defaultOpportunityId,
      messages: [],
    },
    after: {
      buyerId: association.buyerId,
      defaultOpportunityId: association.defaultOpportunityId,
      messages: [{ id: messageId, opportunityId }],
    },
    at,
  });
  await recordEvent(conversationId);
  if (opportunityId) {
    // New engagement invalidates pending unanswered work across the same purchasing need.
    // An older historical import cannot cancel work based on a newer message.
    await stopOpportunityFollowups(
      tx,
      businessId,
      [opportunityId],
      "buyer_replied",
      event.occurredAt,
    );
  }
  return { status: "captured", conversationId };
}
