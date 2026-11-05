import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { InboxRepository } from "../application/inbox";
import { ApplicationError } from "../models/application-error";
import type { InboxConnection, IncomingInquiry } from "../models/inbox";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  inboxConnection,
  inboxBuyer,
  inboxConversation,
  inboxOpportunity,
  inboxMessage,
  inboxEvent,
} from "./schema";

function connectionView(
  row: typeof inboxConnection.$inferSelect,
): InboxConnection {
  return {
    id: row.id,
    label: row.label,
    channel: row.channel,
    conversationRefs: row.conversationRefs,
    active: row.active,
    mode: "normalized_import",
    createdAt: row.createdAt.toISOString(),
  };
}
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
    workspace(actor, businessId) {
      return scoped(database, actor, businessId, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        const connections = await tx
          .select()
          .from(inboxConnection)
          .where(eq(inboxConnection.businessId, businessId))
          .orderBy(desc(inboxConnection.createdAt), asc(inboxConnection.id));
        const rows = await tx
          .select({
            conversation: inboxConversation,
            buyerName: inboxBuyer.name,
            channel: inboxConnection.channel,
            opportunityId: inboxOpportunity.id,
          })
          .from(inboxConversation)
          .innerJoin(inboxBuyer, eq(inboxBuyer.id, inboxConversation.buyerId))
          .innerJoin(
            inboxConnection,
            eq(inboxConnection.id, inboxConversation.connectionId),
          )
          .innerJoin(
            inboxOpportunity,
            eq(inboxOpportunity.conversationId, inboxConversation.id),
          )
          .where(eq(inboxConversation.businessId, businessId))
          .orderBy(
            desc(inboxConversation.lastReceivedAt),
            asc(inboxConversation.id),
          );
        return {
          canManage: role !== "salesperson",
          connections: connections.map(connectionView),
          conversations: rows.map((row) => ({
            id: row.conversation.id,
            subject: row.conversation.subject,
            buyerName: row.buyerName,
            channel: row.channel,
            opportunityId: row.opportunityId,
            lastReceivedAt: row.conversation.lastReceivedAt.toISOString(),
          })),
        };
      });
    },
    conversation(actor, businessId, id) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "sales.work");
        const [row] = await tx
          .select({
            conversation: inboxConversation,
            buyer: inboxBuyer,
            connection: inboxConnection,
            opportunity: inboxOpportunity,
          })
          .from(inboxConversation)
          .innerJoin(inboxBuyer, eq(inboxBuyer.id, inboxConversation.buyerId))
          .innerJoin(
            inboxConnection,
            eq(inboxConnection.id, inboxConversation.connectionId),
          )
          .innerJoin(
            inboxOpportunity,
            eq(inboxOpportunity.conversationId, inboxConversation.id),
          )
          .where(
            and(
              eq(inboxConversation.businessId, businessId),
              eq(inboxConversation.id, id),
            ),
          );
        if (!row) throw new ApplicationError("NOT_FOUND");
        const messages = await tx
          .select()
          .from(inboxMessage)
          .where(
            and(
              eq(inboxMessage.businessId, businessId),
              eq(inboxMessage.conversationId, id),
            ),
          )
          .orderBy(asc(inboxMessage.receivedAt), asc(inboxMessage.id));
        return {
          id,
          subject: row.conversation.subject,
          providerRef: row.conversation.providerRef,
          connection: connectionView(row.connection),
          buyer: {
            id: row.buyer.id,
            name: row.buyer.name,
            senderRef: row.buyer.senderRef,
            geography: row.buyer.geography,
            relationship: "engaged",
          },
          opportunity: {
            id: row.opportunity.id,
            stage: row.opportunity.stage,
            ownerId: row.opportunity.ownerId,
            handoffReason: row.opportunity.handoffReason,
            nextAction: row.opportunity.nextAction,
            createdAt: row.opportunity.createdAt.toISOString(),
          },
          messages: messages.map((message) => ({
            ...message.content,
            id: message.id,
            receivedAt: message.receivedAt.toISOString(),
          })),
        };
      });
    },
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
            await tx.insert(inboxOpportunity).values({
              id: randomUUID(),
              businessId,
              connectionId,
              conversationId,
              stage: "inquiry",
              ownerId: null,
              handoffReason:
                "Human review required; intake grants no action authority",
              nextAction: "Review incoming inquiry",
              createdAt: at,
            });
          } else {
            await tx
              .update(inboxConversation)
              .set({ lastReceivedAt: at })
              .where(eq(inboxConversation.id, conversationId));
          }
          await tx.insert(inboxMessage).values({
            id: randomUUID(),
            businessId,
            connectionId,
            conversationId,
            messageRef: event.messageRef,
            content: event,
            fingerprint: messageFingerprint,
            receivedAt: at,
          });
          await recordEvent(conversationId);
          return { status: "captured", conversationId };
        },
        { lock: true },
      );
    },
  };
}
