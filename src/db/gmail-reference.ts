import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import {
  gmailManualMessage,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxConversation,
} from "./schema";

/** Follow exact retained RFC references to a received message's CURRENT association.
 * Sent observations are provenance, never a second buyer identity or a frozen association.
 */
export async function resolveGmailReference(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
  reference: string,
  participants: string[],
  thread: string | null = null,
  visited = new Set<string>(),
): Promise<
  | { status: "missing" | "ambiguous" }
  | {
      status: "resolved";
      messageId: string;
      conversationId: string;
      opportunityId: string | null;
      buyerId: string;
      originalBuyerId: string;
    }
> {
  if (visited.has(reference) || visited.size >= 20)
    return { status: "ambiguous" };
  visited.add(reference);
  const received = await tx
    .select({
      message: inboxMessage,
      link: inboxMessageLink,
      association: inboxAssociation,
      conversation: inboxConversation,
    })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .innerJoin(
      inboxAssociation,
      eq(inboxMessage.conversationId, inboxAssociation.id),
    )
    .innerJoin(
      inboxConversation,
      eq(inboxMessage.conversationId, inboxConversation.id),
    )
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessage.connectionId, mailboxId),
        sql`${inboxMessage.mailboxMetadata}->'native'->>'internetMessageId' = ${reference}`,
      ),
    );
  const sent = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, businessId),
        eq(gmailManualMessage.mailboxId, mailboxId),
        sql`${gmailManualMessage.content}->'native'->>'internetMessageId' = ${reference}`,
      ),
    );
  if (received.length + sent.length > 1) return { status: "ambiguous" };
  const original = received[0];
  if (original) {
    if (
      (thread && original.conversation.providerRef !== thread) ||
      !participants.includes(original.message.content.senderRef.toLowerCase())
    )
      return { status: "missing" };
    return {
      status: "resolved",
      messageId: original.message.id,
      conversationId: original.message.conversationId,
      opportunityId: original.link.opportunityId,
      buyerId: original.association.buyerId,
      originalBuyerId: original.conversation.buyerId,
    };
  }
  const manual = sent[0];
  if (
    !manual?.content.native.inReplyTo ||
    (thread && manual.content.conversationRef !== thread) ||
    !manual.content.native.to.some((to) => participants.includes(to))
  )
    return { status: "missing" };
  const resolved = await resolveGmailReference(
    tx,
    businessId,
    mailboxId,
    manual.content.native.inReplyTo,
    participants,
    thread,
    visited,
  );
  return resolved.status === "missing" ? { status: "ambiguous" } : resolved;
}
