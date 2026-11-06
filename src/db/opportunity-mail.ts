import { and, eq } from "drizzle-orm";
import type { Transaction } from "./scope";
import type { MailboxBatch } from "../models/mailboxes";
import {
  opportunityDueAction,
  gmailManualMessage,
  mailboxPolicy,
  inboxMessage,
} from "./schema";
import { currentMailbox } from "./email-handoff-observations";
import { handoffSource } from "../application/email-handoff-policy";

export async function opportunityMailReferences(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  account: string,
) {
  const rows = await tx
    .select()
    .from(opportunityDueAction)
    .where(eq(opportunityDueAction.businessId, businessId));
  return rows.flatMap(({ email }) =>
    email &&
    email.envelope.connectionId === connectionId &&
    email.envelope.fromAddress === account
      ? [email.envelope]
      : [],
  );
}

/** A registered application reply is never a human takeover. It still needs exact evidence reconciliation. */
export async function isOpportunityMailObservation(
  tx: Transaction,
  batch: MailboxBatch,
  selected: MailboxBatch["selected"][number],
  at: Date,
) {
  const { snapshot } = batch,
    { event, metadata } = selected;
  if (
    snapshot.provider !== "gmail" ||
    snapshot.mode !== "incremental" ||
    !snapshot.oauthGeneration ||
    event.kind !== "manual_reply" ||
    metadata.native?.direction !== "manual_reply"
  )
    return false;
  const envelopes = await opportunityMailReferences(
    tx,
    snapshot.work.businessId,
    snapshot.configuration.connectionId,
    snapshot.account,
  );
  return envelopes.some(
    (e) =>
      e.mailboxId === snapshot.work.mailboxId &&
      metadata.native?.internetMessageId === e.internetMessageId &&
      metadata.folderRefs.includes("SENT") &&
      event.native.from === e.fromAddress &&
      event.native.to.length === 1 &&
      event.native.to[0] === e.recipient &&
      metadata.native.replyTo?.length === 1 &&
      metadata.native.replyTo[0] === e.replyTo &&
      metadata.native.inReplyTo === e.parent.internetMessageId &&
      event.native.inReplyTo === e.parent.internetMessageId &&
      event.conversationRef === e.parent.threadRef &&
      event.subject === e.subject &&
      event.text.replace(/\r\n|\r/g, "\n") ===
        e.body.replace(/\r\n|\r/g, "\n") &&
      new Date(event.occurredAt) >= new Date(e.reservedAt) &&
      new Date(event.occurredAt) <= at,
  );
}

/** Read-only evidence lookup. A unique message ID, current authorized provenance and every immutable field must agree. */
export async function reconciledOpportunityMail(
  tx: Transaction,
  row: typeof opportunityDueAction.$inferSelect,
  at: Date,
) {
  const mail = row.email;
  if (!mail) return null;
  const e = mail.envelope;
  const [policy] = await tx
    .select()
    .from(mailboxPolicy)
    .where(
      and(
        eq(mailboxPolicy.businessId, row.businessId),
        eq(mailboxPolicy.id, e.mailboxId),
      ),
    );
  if (
    !policy ||
    policy.provider !== "gmail" ||
    policy.connectionId !== e.connectionId ||
    policy.account !== e.fromAddress
  )
    return null;
  const current = await currentMailbox(tx, row.businessId, policy, at);
  if (!current) return null;
  const records = await tx
    .select()
    .from(gmailManualMessage)
    .where(
      and(
        eq(gmailManualMessage.businessId, row.businessId),
        eq(gmailManualMessage.mailboxId, e.mailboxId),
      ),
    );
  const candidates = records.filter(
    (r) =>
      (r.currentMetadata ?? r.metadata).native?.internetMessageId ===
      e.internetMessageId,
  );
  const received = await tx
    .select()
    .from(inboxMessage)
    .where(
      and(
        eq(inboxMessage.businessId, row.businessId),
        eq(inboxMessage.connectionId, e.mailboxId),
      ),
    );
  if (
    candidates.length !== 1 ||
    received.some(
      (r) =>
        (r.mailboxCurrentMetadata ?? r.mailboxMetadata)?.native
          ?.internetMessageId === e.internetMessageId,
    )
  )
    return null;
  const r = candidates[0],
    m = r.currentMetadata ?? r.metadata,
    event = r.content;
  const source = handoffSource(current, {
    id: r.id,
    metadata: m,
    event,
    generation: r.nativeSyncGeneration,
  });
  const receipt =
    mail.result?.status === "accepted" ? mail.result.receipt : null;
  const lines = (s: string) => s.replace(/\r\n|\r/g, "\n");
  if (
    !source ||
    !m.folderRefs.includes("SENT") ||
    event.kind !== "manual_reply" ||
    m.native?.direction !== "manual_reply" ||
    m.native.from !== e.fromAddress ||
    m.native.to.length !== 1 ||
    m.native.to[0] !== e.recipient ||
    m.native.replyTo?.length !== 1 ||
    m.native.replyTo[0] !== e.replyTo ||
    m.native.inReplyTo !== e.parent.internetMessageId ||
    event.native.inReplyTo !== e.parent.internetMessageId ||
    event.conversationRef !== e.parent.threadRef ||
    event.subject !== e.subject ||
    lines(event.text) !== lines(e.body) ||
    new Date(event.occurredAt) < new Date(e.reservedAt) ||
    new Date(event.occurredAt) > at ||
    (receipt &&
      (receipt.messageRef !== source.messageRef ||
        receipt.threadRef !== source.threadRef))
  )
    return null;
  return {
    ...mail,
    sent: source,
    result: receipt
      ? mail.result
      : {
          status: "accepted" as const,
          receipt: {
            actionId: e.actionId,
            attemptId: e.attemptId,
            businessId: row.businessId,
            connectionId: e.connectionId,
            recipient: e.recipient,
            messageRef: source.messageRef,
            threadRef: source.threadRef,
            internetMessageId: source.internetMessageId,
            acceptedAt: source.occurredAt,
            evidence: "sent_folder" as const,
          },
        },
  };
}
