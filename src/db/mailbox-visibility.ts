import { and, eq } from "drizzle-orm";
import { stopOpportunityFollowups } from "./opportunity-followups";
import { pauseMailboxSequences } from "./email-sequence-observations";
import type { Transaction } from "./scope";
import { mailboxPolicy, inboxMessage, inboxMessageLink } from "./schema";

/** Pause the exact affected Opportunities across channels; keep every inbox/history row. */
export async function pauseMailboxFollowups(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
) {
  const needs = await tx
    .select({ id: inboxMessageLink.opportunityId })
    .from(inboxMessageLink)
    .innerJoin(inboxMessage, eq(inboxMessage.id, inboxMessageLink.id))
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessage.connectionId, mailboxId),
      ),
    );
  const ids = [
    ...new Set([
      ...needs.flatMap((n) => (n.id ? [n.id] : [])),
      ...(await pauseMailboxSequences(tx, businessId, mailboxId)),
    ]),
  ];
  await stopOpportunityFollowups(
    tx,
    businessId,
    ids,
    "reply_visibility_unavailable",
  );
}
export async function invalidateMailboxVisibility(
  tx: Transaction,
  businessId: string,
  mailboxId: string,
) {
  await tx
    .update(mailboxPolicy)
    .set({ grant: null, visibility: "unsafe" })
    .where(
      and(
        eq(mailboxPolicy.id, mailboxId),
        eq(mailboxPolicy.businessId, businessId),
      ),
    );
  await pauseMailboxFollowups(tx, businessId, mailboxId);
}
