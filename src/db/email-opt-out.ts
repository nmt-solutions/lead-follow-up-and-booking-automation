import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import { emailRecipientSchema } from "../models/email-eligibility";
import type { IncomingInquiry } from "../models/inbox";
import type { MailboxMetadata } from "../models/mailboxes";
import type { Transaction } from "./scope";
import {
  currentEmailPolicy,
  currentRecipient,
  lockEmailPolicies,
  marketPolicyKey,
} from "./email-eligibility-context";
import { persistEmailSuppression } from "./email-eligibility-repository";
import { resolveMailReference } from "./mailbox-reference";
import { emailSuppression, inboxMessage, inboxMessageLink } from "./schema";

/** Called only inside the authenticated, selected-connection intake transaction and Business lock. */
export async function captureEmailOptOut(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  actorId: string,
  event: IncomingInquiry,
  at: Date,
  metadata?: MailboxMetadata,
) {
  const parsed = emailRecipientSchema.safeParse(event.senderRef);
  if (!parsed.success) throw new ApplicationError("INVALID_INPUT");
  const recipient = parsed.data;
  const hash = createHash("sha256")
    .update(`${businessId}:${connectionId}:${event.messageRef}`)
    .digest("hex");
  const requestKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  const { eventId, ...message } = event;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(message))
    .digest("hex");
  if (
    metadata?.native &&
    (metadata.native.direction !== "incoming" ||
      metadata.native.from.toLowerCase() !== recipient)
  )
    throw new ApplicationError("INVALID_PROVIDER_RESPONSE");
  const [seen] = await tx
    .select()
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.businessId, businessId),
        eq(emailSuppression.requestKey, requestKey),
      ),
    );
  if (seen) {
    if (
      seen.source !== "incoming_opt_out" ||
      seen.recipient !== recipient ||
      seen.evidence?.fingerprint !== fingerprint
    )
      throw new ApplicationError("CONFLICT");
    return {
      status: "duplicate" as const,
      conversationId: seen.evidence.conversationId,
    };
  }
  const native = metadata?.native?.inReplyTo
    ? await resolveMailReference(
        tx,
        businessId,
        connectionId,
        metadata.native.inReplyTo,
        [recipient],
      )
    : null;
  if (native && native.status !== "resolved")
    throw new ApplicationError("CONFLICT");
  const sources = await tx
    .select({ message: inboxMessage, link: inboxMessageLink })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessage.connectionId, connectionId),
        sql`lower(${inboxMessage.content}->>'senderRef') = ${recipient}`,
        event.replyToMessageRef
          ? eq(inboxMessage.messageRef, event.replyToMessageRef)
          : native?.status === "resolved"
            ? eq(inboxMessage.id, native.messageId)
            : sql`${inboxMessage.content}->>'conversationRef' = ${event.conversationRef}`,
      ),
    );
  if (!sources.length) throw new ApplicationError("NOT_FOUND");
  const ids = new Set(sources.map((r) => r.link.opportunityId));
  const opportunityId = sources[0].link.opportunityId;
  await lockEmailPolicies(tx);
  const facts = await currentRecipient(tx, businessId, recipient, at);
  const policy =
    facts?.facts.market && facts.facts.recipientClass !== "unknown"
      ? await currentEmailPolicy(
          tx,
          marketPolicyKey({
            ...facts.facts,
            market: facts.facts.market,
            purpose: "sales_follow_up",
          }),
          at,
        )
      : null;
  // Without configured coverage, the product's conservative Business-recipient outreach stop applies.
  // It never suppresses another Business or claims a universal/legal unsubscribe service.
  const scope =
    policy &&
    new Date(policy.policy.validUntil) > at &&
    facts &&
    new Date(facts.facts.validUntil) > at
      ? policy.policy.incomingOptOutScope
      : "recipient_outreach";
  if (scope === "opportunity_outreach" && (ids.size !== 1 || !opportunityId))
    throw new ApplicationError("CONFLICT");
  const requestExcerpt = event.text
    .slice(0, 1000)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  await persistEmailSuppression(
    tx,
    businessId,
    actorId,
    {
      requestKey,
      recipient,
      scope,
      opportunityId: scope === "opportunity_outreach" ? opportunityId : null,
      effectiveAt: event.occurredAt,
      reference: `Connection ${connectionId}; opt-out message ${event.messageRef}; original ${sources[0].message.id}; request: ${requestExcerpt}. Next: honor covered scope; current owner reviews the restriction. No notification sent.`,
    },
    at,
    "incoming_opt_out",
    {
      connectionId,
      messageRef: event.messageRef,
      eventRef: eventId,
      fingerprint,
      conversationId: sources[0].message.conversationId,
      sourceMessageId: sources[0].message.id,
      policyId: policy?.id ?? null,
    },
  );
  return {
    status: "captured" as const,
    conversationId: sources[0].message.conversationId,
  };
}
