import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import type { MailboxBatch, MailboxMetadata } from "../models/mailboxes";
import { selectedMetadata } from "../models/mailboxes";
import { ApplicationError } from "../models/application-error";
import { captureInboxInquiry } from "./inbox-repository";
import { retainMailObservation } from "./mailbox-intake";
import { resolveMailReference } from "./mailbox-reference";
import {
  sequenceReference,
  observeSequenceReply,
} from "./email-sequence-observations";
import { gmailManualMessage, inboxMessage, inboxMessageLink } from "./schema";

export function selectedRetainedReply(
  batch: MailboxBatch,
  metadata: MailboxMetadata,
) {
  const s = batch.snapshot;
  return (
    selectedMetadata(
      s.configuration,
      metadata,
      s.incrementalSince,
      "incremental",
    ) ||
    Boolean(
      s.configuration.history &&
      selectedMetadata(
        s.configuration,
        metadata,
        s.incrementalSince,
        "history",
      ),
    )
  );
}
/** A missing native reference cannot authorize a conversation-default fallback. Retain the approved observation until its source is observable. */
export async function captureMailInquiry(
  tx: Transaction,
  batch: MailboxBatch,
  selected: MailboxBatch["selected"][number],
  at: Date,
) {
  const { snapshot } = batch,
    { work } = snapshot,
    { event, metadata } = selected;
  if (event.kind === "manual_reply")
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  const [existing] = await tx
    .select({ id: inboxMessage.id })
    .from(inboxMessage)
    .where(
      and(
        eq(inboxMessage.businessId, work.businessId),
        eq(inboxMessage.connectionId, work.mailboxId),
        eq(inboxMessage.messageRef, event.messageRef),
      ),
    );
  if (!existing && metadata.native?.inReplyTo) {
    const sequence = await sequenceReference(
      tx,
      work.businessId,
      work.mailboxId,
      metadata.native.inReplyTo,
      [event.senderRef.toLowerCase()],
    );
    if (sequence) {
      await observeSequenceReply(
        tx,
        work.businessId,
        work.mailboxId,
        work.identity.userId,
        event,
        at,
        metadata,
        snapshot.oauthGeneration
          ? {
              provider: snapshot.provider,
              mailboxId: work.mailboxId,
              connectionId: snapshot.configuration.connectionId,
              policyVersion: work.policyVersion,
              syncGeneration: snapshot.oauthGeneration,
              messageRef: event.messageRef,
              threadRef: event.conversationRef,
              internetMessageId: metadata.native.internetMessageId,
              inReplyTo: metadata.native.inReplyTo,
              occurredAt: event.occurredAt,
            }
          : null,
      );
      // Native adapters classify ordinary incoming mail as direct_inquiry. A reply reference
      // establishes continuity, not buying interest. Retain unclassified replies for review.
      if (event.kind === "buying_interest_reply" || event.kind === "opt_out")
        return captureInboxInquiry(
          tx,
          work.identity,
          work.businessId,
          snapshot.inboxConnectionId,
          event,
          at,
          {
            since: new Date(
              snapshot.mode === "history"
                ? snapshot.configuration.history!.from
                : snapshot.incrementalSince,
            ),
            metadata,
          },
        );
      const status = await retainMailObservation(tx, batch, selected, at);
      return { status };
    }
    const source = await resolveMailReference(
      tx,
      work.businessId,
      work.mailboxId,
      metadata.native.inReplyTo,
      [event.senderRef.toLowerCase()],
    );
    if (source.status !== "resolved" || !source.opportunityId) {
      const status = await retainMailObservation(tx, batch, selected, at);
      return { status };
    }
  }
  return captureInboxInquiry(
    tx,
    work.identity,
    work.businessId,
    snapshot.inboxConnectionId,
    event,
    at,
    {
      since: new Date(
        snapshot.mode === "history"
          ? snapshot.configuration.history!.from
          : snapshot.incrementalSince,
      ),
      metadata,
    },
  );
}

export async function applyPendingMailInquiries(
  tx: Transaction,
  batch: MailboxBatch,
  at: Date,
) {
  const { work } = batch.snapshot;
  // Resolve chains over bounded passes; a later pass can follow a newly captured received reference.
  for (let pass = 0; pass < 20; pass++) {
    const pending = await tx
      .select()
      .from(gmailManualMessage)
      .where(
        and(
          eq(gmailManualMessage.businessId, work.businessId),
          eq(gmailManualMessage.mailboxId, work.mailboxId),
          eq(gmailManualMessage.state, "pending"),
          sql`${gmailManualMessage.content}->>'kind' <> 'manual_reply'`,
        ),
      )
      .orderBy(asc(gmailManualMessage.at), asc(gmailManualMessage.id))
      .limit(1000);
    let progressed = false;
    for (const row of pending) {
      const event = row.content,
        metadata = row.currentMetadata ?? row.metadata;
      if (
        event.kind === "manual_reply" ||
        !metadata.native?.inReplyTo ||
        !selectedRetainedReply(batch, metadata)
      )
        continue;
      const source = await resolveMailReference(
        tx,
        work.businessId,
        work.mailboxId,
        metadata.native.inReplyTo,
        [event.senderRef.toLowerCase()],
      );
      if (source.status !== "resolved" || !source.opportunityId) continue;
      const s = batch.snapshot;
      const since = selectedMetadata(
        s.configuration,
        metadata,
        s.incrementalSince,
        "incremental",
      )
        ? s.incrementalSince
        : s.configuration.history!.from;
      const result = await captureInboxInquiry(
        tx,
        work.identity,
        work.businessId,
        work.mailboxId,
        event,
        at,
        { since: new Date(since), metadata },
      );
      if (!result.conversationId) continue;
      const [captured] = await tx
        .select({ opportunityId: inboxMessageLink.opportunityId })
        .from(inboxMessage)
        .innerJoin(inboxMessageLink, eq(inboxMessageLink.id, inboxMessage.id))
        .where(
          and(
            eq(inboxMessage.businessId, work.businessId),
            eq(inboxMessage.connectionId, work.mailboxId),
            eq(inboxMessage.messageRef, event.messageRef),
          ),
        );
      await tx
        .update(gmailManualMessage)
        .set({
          state: "applied",
          conversationId: result.conversationId,
          opportunityId: captured?.opportunityId ?? null,
        })
        .where(
          and(
            eq(gmailManualMessage.id, row.id),
            eq(gmailManualMessage.businessId, work.businessId),
          ),
        );
      progressed = true;
    }
    if (!progressed) break;
  }
}
