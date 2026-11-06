import { and, eq, inArray, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import { inboxMessage, opportunityDueAction } from "./schema";

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
