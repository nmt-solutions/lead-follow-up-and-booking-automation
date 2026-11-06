import { mailboxMessageAllowed } from "./mailbox-processing";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import {
  aiActivation,
  knowledgeRevision,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxAssociationHistory,
  inboxOpportunity,
  inquiryRun,
} from "./schema";
import { knowledgeState } from "../models/knowledge";
import { ApplicationError } from "../models/application-error";
import type { InquirySnapshot } from "../models/inquiries";

export async function lockInquiryProfile(tx: Transaction) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('approved-ai-profiles', 0))`,
  );
}
export async function inquiryContext(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
  at: Date,
) {
  const [need] = await tx
    .select()
    .from(inboxOpportunity)
    .where(
      and(
        eq(inboxOpportunity.businessId, businessId),
        eq(inboxOpportunity.id, opportunityId),
      ),
    );
  if (!need) throw new ApplicationError("NOT_FOUND");
  const rows = await tx
    .select()
    .from(knowledgeRevision)
    .where(eq(knowledgeRevision.businessId, businessId))
    .orderBy(asc(knowledgeRevision.version));
  const knowledge = knowledgeState(
    rows.map((r) => ({ ...r, at: r.at.toISOString() })),
    false,
  ).current;
  const [activation] = await tx
    .select()
    .from(aiActivation)
    .orderBy(desc(aiActivation.version))
    .limit(1);
  const sources = await tx
    .select({
      id: inboxMessage.id,
      connectionId: inboxMessage.connectionId,
      metadata: inboxMessage.mailboxMetadata,
      text: inboxMessage.content,
      sequence: inboxMessageLink.sequence,
      associationVersion: inboxAssociation.version,
    })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .innerJoin(
      inboxAssociation,
      eq(inboxMessage.conversationId, inboxAssociation.id),
    )
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessageLink.opportunityId, opportunityId),
      ),
    )
    .orderBy(
      asc(inboxMessage.receivedAt),
      asc(inboxMessageLink.sequence),
      asc(inboxMessage.id),
    );
  const corrections = await tx
    .select()
    .from(inboxAssociationHistory)
    .where(eq(inboxAssociationHistory.businessId, businessId));
  const allowedSources = [];
  for (const source of sources)
    if (
      await mailboxMessageAllowed(
        tx,
        businessId,
        source.connectionId,
        source.metadata,
        at,
      )
    )
      allowedSources.push(source);
  const messages = allowedSources.map((source) => ({
    ...source,
    correctionVersion: Math.max(
      0,
      ...corrections
        .filter(
          (r) =>
            !r.sourceEventId &&
            r.after.messages.some((m) => m.id === source.id),
        )
        .map((r) => r.version),
    ),
  }));
  const snapshot: InquirySnapshot = {
    controlVersion: need.controlVersion,
    knowledgeVersion: knowledge?.version ?? null,
    profileId: activation?.profileId ?? null,
    activationVersion: activation?.version ?? 0,
    messages: messages.map(
      ({ id, associationVersion, correctionVersion, sequence }) => ({
        id,
        associationVersion,
        correctionVersion,
        sequence,
      }),
    ),
  };
  return { need, knowledge, messages, snapshot };
}
export function sameInquirySnapshot(a: InquirySnapshot, b: InquirySnapshot) {
  return (
    a.controlVersion === b.controlVersion &&
    a.knowledgeVersion === b.knowledgeVersion &&
    a.profileId === b.profileId &&
    a.activationVersion === b.activationVersion &&
    a.messages.length === b.messages.length &&
    a.messages.every((m, i) => {
      const other = b.messages[i];
      return (
        m.id === other.id &&
        m.associationVersion === other.associationVersion &&
        m.correctionVersion === other.correctionVersion &&
        m.sequence === other.sequence
      );
    })
  );
}
/** Called under the #19 Business lock and the shared profile lock through provider I/O. */
export async function inquiryDispatchContext(
  tx: Transaction,
  businessId: string,
  id: string,
  opportunityId: string,
  at: Date,
) {
  const [run] = await tx
    .select()
    .from(inquiryRun)
    .where(
      and(
        eq(inquiryRun.id, id),
        eq(inquiryRun.businessId, businessId),
        eq(inquiryRun.opportunityId, opportunityId),
      ),
    );
  if (!run) return { reason: "inquiry_missing", reply: undefined };
  const current = await inquiryContext(tx, businessId, opportunityId, at);
  if (
    run.result.status !== "ready" ||
    !run.result.body ||
    !sameInquirySnapshot(run.snapshot, current.snapshot)
  )
    return { reason: "inquiry_context_changed", reply: undefined };
  const message = current.messages.find((v) => v.id === run.messageId);
  if (!message) return { reason: "association_changed", reply: undefined };
  return {
    reason: null,
    reply: {
      text: run.result.body,
      recipientRef: message.text.senderRef,
      conversationRef: message.text.conversationRef,
      replyToMessageRef: message.text.messageRef,
      inquiryRunId: run.id,
    },
  };
}
