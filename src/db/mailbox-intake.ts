import { createHash, randomUUID } from "node:crypto";
import { and, eq, asc, desc, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import { ApplicationError } from "../models/application-error";
import type { MailboxBatch } from "../models/mailboxes";
import { selectedMetadata } from "../models/mailboxes";
import { writeControl } from "./opportunity-control-repository";
import { resolveMailReference } from "./mailbox-reference";
import { isOpportunityMailObservation } from "./opportunity-mail";
import {
  sequenceReference,
  observeSequenceSent,
} from "./email-sequence-observations";
import {
  gmailManualMessage,
  inboxOpportunity,
  opportunityControlHistory,
  opportunityManualEvent,
  mailboxAppMessage,
} from "./schema";

export async function retainMailManual(
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
  if (
    (await isOpportunityMailObservation(tx, batch, selected)) ||
    (await observeSequenceSent(tx, batch, selected, at))
  ) {
    await retainMailObservation(tx, batch, selected, at);
    await tx
      .update(gmailManualMessage)
      .set({ state: "applied" })
      .where(
        and(
          eq(gmailManualMessage.businessId, work.businessId),
          eq(gmailManualMessage.mailboxId, work.mailboxId),
          eq(gmailManualMessage.messageRef, event.messageRef),
        ),
      );
    return "duplicate";
  }
  const [appSend] = await tx
    .select()
    .from(mailboxAppMessage)
    .where(
      and(
        eq(mailboxAppMessage.businessId, work.businessId),
        eq(mailboxAppMessage.mailboxId, work.mailboxId),
        eq(mailboxAppMessage.messageRef, event.messageRef),
        eq(mailboxAppMessage.internetMessageId, event.native.internetMessageId),
      ),
    );
  if (appSend) return "duplicate";
  return retainMailObservation(tx, batch, selected, at);
}
export async function retainMailObservation(
  tx: Transaction,
  batch: MailboxBatch,
  selected: MailboxBatch["selected"][number],
  at: Date,
) {
  const { event, metadata } = selected,
    { work } = batch.snapshot;
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
export async function applyMailManual(
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
        sql`${gmailManualMessage.content}->>'kind' = 'manual_reply'`,
      ),
    )
    .orderBy(asc(gmailManualMessage.at), asc(gmailManualMessage.id))
    .limit(1000);
  for (const manual of pending) {
    if (
      !selectedMetadata(
        snapshot.configuration,
        manual.currentMetadata ?? manual.metadata,
        snapshot.incrementalSince,
        snapshot.mode,
      )
    )
      continue;
    const event = manual.content;
    if (event.kind !== "manual_reply") continue;
    if (!event.native.inReplyTo) continue;
    const original = await resolveMailReference(
      tx,
      work.businessId,
      work.mailboxId,
      event.native.inReplyTo,
      event.native.to,
      event.conversationRef,
    );
    const sequence =
      original.status !== "resolved"
        ? await sequenceReference(
            tx,
            work.businessId,
            work.mailboxId,
            event.native.inReplyTo,
            event.native.to,
          )
        : null;
    const opportunityId =
      original.status === "resolved"
        ? original.opportunityId
        : sequence?.action.opportunityId;
    if (!opportunityId) continue;
    const [need] = await tx
      .select()
      .from(inboxOpportunity)
      .where(
        and(
          eq(inboxOpportunity.businessId, work.businessId),
          eq(inboxOpportunity.id, opportunityId),
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
          reason: `Manual ${snapshot.provider === "microsoft" ? "Outlook" : "Gmail"} reply observed in the selected mail`,
          nextAction: `Continue with the buyer in ${snapshot.provider === "microsoft" ? "Outlook" : "Gmail"} or explicitly hand this Opportunity back`,
        },
        "manual_reply",
        at,
        null,
        `${snapshot.provider}:${event.messageRef}`,
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
        conversationId:
          original.status === "resolved" ? original.conversationId : null,
        opportunityId: need.id,
      })
      .where(eq(gmailManualMessage.id, manual.id));
  }
}

export async function mailManualHistory(
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
        sql`${gmailManualMessage.content}->>'kind' = 'manual_reply'`,
      ),
    )
    .orderBy(asc(gmailManualMessage.at), asc(gmailManualMessage.id))
    .limit(500);
  return records.flatMap((r) =>
    r.content.kind !== "manual_reply"
      ? []
      : [
          {
            id: r.id,
            subject: r.content.subject,
            text: r.content.text,
            from: r.content.native.from,
            to: r.content.native.to,
            occurredAt: r.content.occurredAt,
            state: r.state,
            opportunityId: r.opportunityId,
          },
        ],
  );
}
