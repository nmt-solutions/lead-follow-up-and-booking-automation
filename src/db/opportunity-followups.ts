import { and, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import {
  inboxBuyer,
  inboxConnection,
  inboxOpportunity,
  inboxMessage,
  opportunityDueAction,
} from "./schema";

/** First outreach must give way to already engaged recipients and existing human control.
 * An exact address is only a stop key here; it never merges buyer identities or Opportunities. */
export async function firstOutreachConversationState(
  tx: Transaction,
  businessId: string,
  addresses: string[],
) {
  if (!addresses.length)
    return {
      status: "allowed" as const,
      reason:
        "No direct engagement is recorded for the selected addresses. Approval creates none.",
    };
  const rows = await tx
    .select({ state: inboxOpportunity.controlState })
    .from(inboxBuyer)
    .innerJoin(inboxConnection, eq(inboxConnection.id, inboxBuyer.connectionId))
    .leftJoin(
      inboxOpportunity,
      and(
        eq(inboxOpportunity.buyerId, inboxBuyer.id),
        eq(inboxOpportunity.businessId, businessId),
      ),
    )
    .where(
      and(
        eq(inboxBuyer.businessId, businessId),
        eq(inboxConnection.channel, "email"),
        sql`lower(${inboxBuyer.senderRef}) in (${sql.join(
          addresses.map((a) => sql`${a}`),
          sql`,`,
        )})`,
      ),
    );
  return rows.length
    ? {
        status: "blocked" as const,
        reason: rows.some((r) => r.state === "human")
          ? "A selected recipient has direct engagement under human control. Review the inbox; campaign approval cannot hand it back."
          : "A selected recipient already has direct engagement. Review the current conversation and stop first-outreach reminders.",
      }
    : {
        status: "allowed" as const,
        reason:
          "No direct engagement is recorded for the selected addresses. Approval creates none.",
      };
}

type StopReason = "buyer_replied" | "reply_visibility_unavailable";
/** Preserve an ambiguous prior dispatch while fencing an acquired invocation that has not called its provider. */
export async function stopOpportunityFollowups(
  tx: Transaction,
  businessId: string,
  opportunityIds: string[],
  reason: StopReason,
  through?: string,
) {
  if (!opportunityIds.length) return;
  const condition = and(
    eq(opportunityDueAction.businessId, businessId),
    inArray(opportunityDueAction.opportunityId, opportunityIds),
    through
      ? inArray(
          opportunityDueAction.messageId,
          tx
            .select({ id: inboxMessage.id })
            .from(inboxMessage)
            .where(
              and(
                eq(inboxMessage.businessId, businessId),
                sql`(${inboxMessage.content}->>'occurredAt')::timestamptz <= ${through}::timestamptz`,
              ),
            ),
        )
      : undefined,
  );
  await tx
    .update(opportunityDueAction)
    .set({ state: "cancelled", reason })
    .where(and(condition, eq(opportunityDueAction.state, "pending")));
  await tx
    .update(opportunityDueAction)
    .set({ reason: `${reason}_dispatch_unconfirmed` })
    .where(and(condition, eq(opportunityDueAction.state, "committed")));
}
export function committedFollowupStopReason(
  reason: string | null,
): StopReason | null {
  if (reason === "buyer_replied_dispatch_unconfirmed") return "buyer_replied";
  if (reason === "reply_visibility_unavailable_dispatch_unconfirmed")
    return "reply_visibility_unavailable";
  return null;
}
