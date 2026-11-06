import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { IncomingInquiry } from "../models/inbox";
import type { MailboxMetadata, MailboxBatch } from "../models/mailboxes";
import type { Transaction } from "./scope";
import type { HandoffSource } from "../models/email-handoffs";
import {
  emailSequenceAction,
  emailSequenceEvent,
  emailSequenceRun,
  campaignRevision,
  mailboxPolicy,
  inboxOpportunity,
} from "./schema";

export async function finishStoppedSequence(
  tx: Transaction,
  businessId: string,
  runId: string,
) {
  const actions = await tx
    .select({ state: emailSequenceAction.state })
    .from(emailSequenceAction)
    .where(
      and(
        eq(emailSequenceAction.businessId, businessId),
        eq(emailSequenceAction.runId, runId),
      ),
    );
  if (
    actions.length &&
    actions.every((a) => a.state === "accepted" || a.state === "cancelled")
  )
    await tx
      .update(emailSequenceRun)
      .set({
        state: "completed",
        reason: actions.some((a) => a.state === "cancelled")
          ? "sequence_stopped"
          : null,
      })
      .where(
        and(
          eq(emailSequenceRun.businessId, businessId),
          eq(emailSequenceRun.id, runId),
          eq(emailSequenceRun.state, "active"),
        ),
      );
}
export async function cancelSequenceRecipient(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
  reason: string,
) {
  await tx
    .update(emailSequenceAction)
    .set({ state: "cancelled", reason, queueState: "none" })
    .where(
      and(
        eq(emailSequenceAction.businessId, businessId),
        eq(emailSequenceAction.opportunityId, opportunityId),
        inArray(emailSequenceAction.state, [
          "pending",
          "waiting",
          "paused",
          "failed",
        ]),
      ),
    );
}

export async function sequenceMailboxReferences(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  account: string,
) {
  const rows = await tx
    .select()
    .from(emailSequenceEvent)
    .where(
      and(
        eq(emailSequenceEvent.businessId, businessId),
        eq(emailSequenceEvent.kind, "attempt_reserved"),
      ),
    );
  return rows.flatMap(({ envelope: e }) =>
    e && e.replyConnectionId === connectionId && e.replyTo === account
      ? [
          {
            internetMessageId: e.internetMessageId,
            recipient: e.recipient,
            fromAddress: e.fromAddress,
            replyTo: e.replyTo,
          },
        ]
      : [],
  );
}

/** Exact outgoing identity, participants and reply route; no subject similarity or address-only Opportunity merge. */
export async function sequenceReference(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  reference: string,
  participants: string[],
) {
  const [mailbox] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, businessId),
        eq(mailboxPolicy.id, connectionId),
      ),
    );
  const reservations = await tx
    .select()
    .from(emailSequenceEvent)
    .where(
      and(
        eq(emailSequenceEvent.businessId, businessId),
        eq(emailSequenceEvent.kind, "attempt_reserved"),
      ),
    );
  const actions = await tx
    .select()
    .from(emailSequenceAction)
    .where(eq(emailSequenceAction.businessId, businessId));
  const matches = reservations.flatMap((e) => {
    const envelope = e.envelope,
      a = actions.find((a) => a.id === e.actionId);
    if (
      !envelope ||
      !a ||
      !(
        envelope.replyInboxId === connectionId ||
        (mailbox?.connectionId === envelope.replyConnectionId &&
          mailbox.account === envelope.replyTo)
      ) ||
      !participants.includes(envelope.recipient)
    )
      return [];
    const receipt = a.receipt;
    if (
      reference !== envelope.internetMessageId &&
      reference !== receipt?.messageRef
    )
      return [];
    return [{ action: a, envelope, reservedAt: e.at }];
  });
  return matches.length === 1 ? matches[0] : null;
}
export async function observeSequenceReply(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  actorId: string,
  event: IncomingInquiry,
  at: Date,
  metadata?: MailboxMetadata,
  source: HandoffSource | null = null,
) {
  if (event.kind === "public_signal") return null;
  const reference = metadata?.native?.inReplyTo ?? event.replyToMessageRef;
  if (!reference) return null;
  const original = await sequenceReference(
    tx,
    businessId,
    connectionId,
    reference,
    [event.senderRef.toLowerCase()],
  );
  if (
    !original ||
    new Date(event.occurredAt) < original.reservedAt ||
    (metadata?.native &&
      (!metadata.native.to.includes(original.envelope.replyTo) ||
        metadata.native.direction !== "incoming"))
  )
    return null;
  const a = original.action;
  const [seen] = await tx
    .select()
    .from(emailSequenceEvent)
    .where(
      and(
        eq(emailSequenceEvent.businessId, businessId),
        eq(emailSequenceEvent.actionId, a.id),
        eq(emailSequenceEvent.kind, "reply_observed"),
        eq(emailSequenceEvent.reason, event.messageRef),
      ),
    );
  if (seen) return a.opportunityId;
  await tx.insert(emailSequenceEvent).values({
    id: randomUUID(),
    businessId,
    runId: a.runId,
    actionId: a.id,
    kind: "reply_observed",
    reason: event.messageRef,
    actorId,
    at,
    source,
  });
  await tx
    .update(inboxOpportunity)
    .set({
      handoffReason:
        "A reply was captured; review the current conversation before further outreach",
      nextAction: "Review the captured reply and decide the next action",
    })
    .where(
      and(
        eq(inboxOpportunity.businessId, businessId),
        eq(inboxOpportunity.id, a.opportunityId),
      ),
    );
  await cancelSequenceRecipient(
    tx,
    businessId,
    a.opportunityId,
    "buyer_replied",
  );
  await finishStoppedSequence(tx, businessId, a.runId);
  return a.opportunityId;
}
export async function pauseMailboxSequences(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
) {
  const rows = await tx
    .select({ action: emailSequenceAction, revision: campaignRevision })
    .from(emailSequenceAction)
    .innerJoin(
      emailSequenceRun,
      and(
        eq(emailSequenceRun.id, emailSequenceAction.runId),
        eq(emailSequenceRun.businessId, businessId),
      ),
    )
    .innerJoin(
      campaignRevision,
      and(
        eq(campaignRevision.id, emailSequenceRun.revisionId),
        eq(campaignRevision.businessId, businessId),
      ),
    )
    .where(eq(emailSequenceAction.businessId, businessId));
  const affected = rows.filter(
    (r) =>
      r.revision.snapshot.senderContext.replyRoute?.configuration
        .inboxConnectionId === mailboxId,
  );
  for (const { action } of affected)
    if (["pending", "waiting"].includes(action.state))
      await tx
        .update(emailSequenceAction)
        .set({
          state: "paused",
          reason: "reply_visibility_unavailable",
          queueState: "none",
        })
        .where(
          and(
            eq(emailSequenceAction.businessId, businessId),
            eq(emailSequenceAction.id, action.id),
          ),
        );
  return affected.map((r) => r.action.opportunityId);
}

export async function observeSequenceSent(
  tx: Transaction,
  batch: MailboxBatch,
  selected: MailboxBatch["selected"][number],
  at: Date,
) {
  const { event, metadata } = selected,
    { snapshot } = batch,
    native = metadata.native;
  if (
    snapshot.mode !== "incremental" ||
    event.kind !== "manual_reply" ||
    native?.direction !== "manual_reply" ||
    !snapshot.oauthGeneration
  )
    return false;
  const original = await sequenceReference(
    tx,
    snapshot.work.businessId,
    snapshot.work.mailboxId,
    native.internetMessageId,
    event.native.to,
  );
  if (!original) return false;
  const e = original.envelope;
  const sentFolder =
    snapshot.provider === "gmail"
      ? "SENT"
      : snapshot.permissionObservation?.microsoft?.sentFolderRef;
  if (
    !sentFolder ||
    !metadata.folderRefs.includes(sentFolder) ||
    event.native.from !== e.fromAddress ||
    event.native.to.length !== 1 ||
    event.subject !== e.subject ||
    event.text.replace(/\r\n|\r/g, "\n") !== e.body.replace(/\r\n|\r/g, "\n") ||
    new Date(event.occurredAt) < original.reservedAt ||
    native.internetMessageId !== e.internetMessageId
  )
    return false;
  const [seen] = await tx
    .select()
    .from(emailSequenceEvent)
    .where(
      and(
        eq(emailSequenceEvent.businessId, e.businessId),
        eq(emailSequenceEvent.actionId, e.actionId),
        eq(emailSequenceEvent.kind, "sent_folder_observed"),
        eq(emailSequenceEvent.reason, event.messageRef),
      ),
    );
  if (!seen)
    await tx.insert(emailSequenceEvent).values({
      id: randomUUID(),
      businessId: e.businessId,
      runId: e.runId,
      actionId: e.actionId,
      kind: "sent_folder_observed",
      reason: event.messageRef,
      actorId: snapshot.work.identity.userId,
      attemptId: e.attemptId,
      at,
      source: {
        provider: snapshot.provider,
        mailboxId: snapshot.work.mailboxId,
        connectionId: snapshot.configuration.connectionId,
        policyVersion: snapshot.work.policyVersion,
        syncGeneration: snapshot.oauthGeneration,
        messageRef: event.messageRef,
        threadRef: event.conversationRef,
        internetMessageId: native.internetMessageId,
        inReplyTo: native.inReplyTo,
        occurredAt: event.occurredAt,
      },
    });
  return true;
}

export async function stopSuppressedSequences(
  tx: Transaction,
  businessId: string,
  recipient: string,
  opportunityId: string | null,
  actorId: string,
  at: Date,
) {
  const candidates = await tx
    .select({ action: emailSequenceAction, revision: campaignRevision })
    .from(emailSequenceAction)
    .innerJoin(
      emailSequenceRun,
      and(
        eq(emailSequenceRun.id, emailSequenceAction.runId),
        eq(emailSequenceRun.businessId, businessId),
      ),
    )
    .innerJoin(
      campaignRevision,
      and(
        eq(campaignRevision.id, emailSequenceRun.revisionId),
        eq(campaignRevision.businessId, businessId),
      ),
    )
    .where(
      and(
        eq(emailSequenceAction.businessId, businessId),
        inArray(emailSequenceAction.state, [
          "pending",
          "waiting",
          "paused",
          "failed",
        ]),
      ),
    );
  for (const { action: a, revision: r } of candidates) {
    if (opportunityId && a.opportunityId !== opportunityId) continue;
    if (
      !r.snapshot.recipients.some(
        (r) => r.contactId === a.contactId && r.address === recipient,
      )
    )
      continue;
    await tx
      .update(emailSequenceAction)
      .set({
        state: "cancelled",
        reason: "recipient_suppressed",
        queueState: "none",
      })
      .where(
        and(
          eq(emailSequenceAction.businessId, businessId),
          eq(emailSequenceAction.id, a.id),
        ),
      );
    await tx.insert(emailSequenceEvent).values({
      id: randomUUID(),
      businessId,
      runId: a.runId,
      actionId: a.id,
      kind: "cancelled",
      reason: "recipient_suppressed",
      actorId,
      at,
    });
    await finishStoppedSequence(tx, businessId, a.runId);
  }
}
