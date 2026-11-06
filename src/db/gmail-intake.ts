import { createHash, randomUUID } from "node:crypto";
import { and, eq, asc, desc } from "drizzle-orm";
import type { Transaction } from "./scope";
import { ApplicationError } from "../models/application-error";
import type { MailboxBatch } from "../models/mailboxes";
import { selectedMetadata } from "../models/mailboxes";
import { writeControl } from "./opportunity-control-repository";
import { resolveGmailReference } from "./gmail-reference";
import {
  gmailManualMessage,
  inboxOpportunity,
  opportunityControlHistory,
  opportunityManualEvent,
} from "./schema";

export async function retainGmailManual(
  tx: Transaction,
  batch: MailboxBatch,
  selected: MailboxBatch["selected"][number],
  at: Date,
) {
  const { event, metadata } = selected;
  if (
    event.kind !== "manual_reply" ||
    !metadata.native ||
    metadata.native.direction !== "manual_reply" ||
    event.native.from !== batch.snapshot.account.toLowerCase()
  )
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  const { work } = batch.snapshot;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(event))
    .digest("hex");
  const [seen] = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, work.businessId),
        eq(gmailManualMessage.mailboxId, work.mailboxId),
        eq(gmailManualMessage.messageRef, event.messageRef),
      ),
    );
  if (seen) {
    if (seen.fingerprint !== fingerprint)
      throw new ApplicationError("CONFLICT");
    return "duplicate";
  }
  await tx.insert(gmailManualMessage).values({
    id: randomUUID(),
    businessId: work.businessId,
    mailboxId: work.mailboxId,
    policyVersion: work.policyVersion,
    messageRef: event.messageRef,
    metadata,
    content: event,
    fingerprint,
    state: "pending",
    actorId: work.identity.userId,
    at,
  });
  return "captured";
}
/** Deferred exact RFC reply references handle reordered pages without inventing a buyer/Opportunity. */
export async function applyGmailManual(
  tx: Transaction,
  batch: MailboxBatch,
  at: Date,
) {
  const { snapshot } = batch,
    { work } = snapshot;
  const pending = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, work.businessId),
        eq(gmailManualMessage.mailboxId, work.mailboxId),
        eq(gmailManualMessage.state, "pending"),
      ),
    )
    .orderBy(asc(gmailManualMessage.at), asc(gmailManualMessage.id))
    .limit(1000);
  for (const manual of pending) {
    if (
      !selectedMetadata(
        snapshot.configuration,
        manual.metadata,
        snapshot.incrementalSince,
        snapshot.mode,
      )
    )
      continue;
    const event = manual.content;
    if (!event.native.inReplyTo) continue;
    const original = await resolveGmailReference(
      tx,
      work.businessId,
      work.mailboxId,
      event.native.inReplyTo,
      event.native.to,
      event.conversationRef,
    );
    if (original.status !== "resolved" || !original.opportunityId) continue;
    const [need] = await tx
      .select()
      .from(inboxOpportunity)
      .where(
        and(
          eq(inboxOpportunity.businessId, work.businessId),
          eq(inboxOpportunity.id, original.opportunityId),
        ),
      );
    if (!need) continue;
    const [latest] = await tx
      .select()
      .from(opportunityControlHistory)
      .where(
        and(
          eq(opportunityControlHistory.businessId, work.businessId),
          eq(opportunityControlHistory.opportunityId, need.id),
        ),
      )
      .orderBy(
        desc(opportunityControlHistory.at),
        desc(opportunityControlHistory.id),
      )
      .limit(1);
    const historical = latest && new Date(event.occurredAt) <= latest.at;
    if (!historical) {
      await writeControl(
        tx,
        work.identity,
        work.businessId,
        need,
        {
          reason: "Manual Gmail reply observed in the selected mail",
          nextAction:
            "Continue with the buyer in Gmail or explicitly hand this Opportunity back",
        },
        "manual_reply",
        at,
        null,
        `gmail:${event.messageRef}`,
      );
      await tx.insert(opportunityManualEvent).values({
        id: randomUUID(),
        businessId: work.businessId,
        connectionId: work.mailboxId,
        opportunityId: need.id,
        actorId: work.identity.userId,
        eventRef: event.eventId,
        messageRef: event.messageRef,
        fingerprint: manual.fingerprint,
        occurredAt: new Date(event.occurredAt),
        at,
      });
    }
    await tx
      .update(gmailManualMessage)
      .set({
        state: historical ? "historical" : "applied",
        conversationId: original.conversationId,
        opportunityId: need.id,
      })
      .where(eq(gmailManualMessage.id, manual.id));
  }
}

export async function gmailManualHistory(
  tx: Transaction,
  businessId: string,
  conversationId: string,
) {
  const records = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, businessId),
        eq(gmailManualMessage.conversationId, conversationId),
      ),
    )
    .orderBy(asc(gmailManualMessage.at), asc(gmailManualMessage.id))
    .limit(500);
  return records.map((r) => ({
    id: r.id,
    subject: r.content.subject,
    text: r.content.text,
    from: r.content.native.from,
    to: r.content.native.to,
    occurredAt: r.content.occurredAt,
    state: r.state,
    opportunityId: r.opportunityId,
  }));
}
