import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { InboxRepository } from "../application/inbox";
import { ApplicationError } from "../models/application-error";
import type { IncomingInquiry } from "../models/inbox";
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
        return connectionView(await requireConnection(tx, businessId, id));
      });
    },
    capture(actor, businessId, connectionId, event, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          // Recheck after normalization; role/connection revocation can race adapter I/O.
          await requireCapability(tx, actor, businessId, "integrations.manage");
          const connection = await requireConnection(
            tx,
            businessId,
            connectionId,
          );
          if (
            new Date(event.occurredAt) < connection.createdAt ||
            (connection.conversationRefs.length &&
              !connection.conversationRefs.includes(event.conversationRef))
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
            const opportunityId = randomUUID();
            const [candidate] = await tx
              .select({ id: inboxOpportunity.id })
              .from(inboxOpportunity)
              .where(
                and(
                  eq(inboxOpportunity.businessId, businessId),
                  eq(inboxOpportunity.buyerId, buyerId),
                ),
              )
              .limit(1);
            await tx.insert(inboxOpportunity).values({
              id: opportunityId,
              businessId,
              buyerId,
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
                buyerId,
                defaultOpportunityId: opportunityId,
                version: 0,
                reviewReason: candidate
                  ? "Buyer has other purchasing needs; compare before associating"
                  : null,
                reviewOwnerId: actor.userId,
                nextAction: candidate
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
          let opportunityId = association.defaultOpportunityId;
          if (event.replyToMessageRef) {
            const [reply] = await tx
              .select({
                opportunityId: inboxMessageLink.opportunityId,
                buyerId: inboxAssociation.buyerId,
              })
              .from(inboxMessage)
              .innerJoin(
                inboxMessageLink,
                eq(inboxMessageLink.id, inboxMessage.id),
              )
              .innerJoin(
                inboxAssociation,
                eq(inboxAssociation.id, inboxMessage.conversationId),
              )
              .where(
                and(
                  eq(inboxMessage.businessId, businessId),
                  eq(inboxMessage.connectionId, connectionId),
                  eq(inboxMessage.messageRef, event.replyToMessageRef),
                ),
              );
            if (reply)
              opportunityId =
                reply.buyerId === association.buyerId
                  ? reply.opportunityId
                  : null;
          }
          const messageId = randomUUID();
          await tx.insert(inboxMessage).values({
            id: messageId,
            businessId,
            connectionId,
            conversationId,
            messageRef: event.messageRef,
            content: event,
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
          return { status: "captured", conversationId };
        },
        { lock: true },
      );
    },
  };
}
