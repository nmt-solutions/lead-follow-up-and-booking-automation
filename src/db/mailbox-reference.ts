import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import {
  gmailManualMessage,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxConversation,
  mailboxAppMessage,
} from "./schema";

/** Follow exact retained RFC references to a received message's CURRENT association.
 * Sent observations are provenance, never a second buyer identity or a frozen association.
 */
export async function resolveMailReference(
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
  const appSent = await tx
    .select({ replyToMessageId: mailboxAppMessage.replyToMessageId })
    .from(mailboxAppMessage)
    .where(
      and(
        eq(mailboxAppMessage.businessId, businessId),
        eq(mailboxAppMessage.mailboxId, mailboxId),
        eq(mailboxAppMessage.internetMessageId, reference),
      ),
    );
  if (received.length + sent.length + appSent.length > 1)
    return { status: "ambiguous" };
  if (appSent[0]) {
    const [source] = await tx
      .select()
      .from(inboxMessage)
      .where(
        and(
          eq(inboxMessage.id, appSent[0].replyToMessageId),
          eq(inboxMessage.businessId, businessId),
          eq(inboxMessage.connectionId, mailboxId),
        ),
      );
    const sourceRef = source?.mailboxMetadata?.native?.internetMessageId;
    if (!sourceRef) return { status: "missing" };
    return resolveMailReference(
      tx,
      businessId,
      mailboxId,
      sourceRef,
      participants,
      thread,
      visited,
    );
  }
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
  const resolved = await resolveMailReference(
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
