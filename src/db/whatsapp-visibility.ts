import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import {
  whatsAppIntake,
  whatsAppConnection,
  whatsAppReceipt,
  inboxMessage,
  inboxMessageLink,
  inboxConnection,
  inboxConversation,
  membership,
} from "./schema";

export async function metaInboundAllowed(
  tx: Transaction,
  businessId: string,
  connectionId: string,
) {
  const [r] = await tx
    .select({
      intake: whatsAppIntake,
      connection: whatsAppConnection,
      role: membership.role,
    })
    .from(whatsAppIntake)
    .innerJoin(whatsAppConnection, eq(whatsAppConnection.id, whatsAppIntake.id))
    .innerJoin(
      membership,
      and(
        eq(membership.businessId, whatsAppIntake.businessId),
        eq(membership.userId, whatsAppIntake.actorId),
      ),
    )
    .where(
      and(
        eq(whatsAppIntake.businessId, businessId),
        eq(whatsAppIntake.inboxConnectionId, connectionId),
      ),
    );
  return (
    !!r &&
    (r.role === "owner" || r.role === "admin") &&
    r.intake.connectionVersion === r.connection.version &&
    r.connection.status === "connected" &&
    !!r.connection.credentials
  );
}
export async function metaOpportunityVisible(
  tx: Transaction,
  businessId: string,
  opportunityId: string,
) {
  const sources = await tx
    .select({
      connectionId: inboxMessage.connectionId,
      content: inboxMessage.content,
    })
    .from(inboxMessage)
    .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
    .innerJoin(
      inboxConnection,
      eq(inboxConnection.id, inboxMessage.connectionId),
    )
    .where(
      and(
        eq(inboxMessage.businessId, businessId),
        eq(inboxMessageLink.opportunityId, opportunityId),
        eq(inboxConnection.mode, "meta"),
      ),
    );
  for (const source of sources) {
    if (!(await metaInboundAllowed(tx, businessId, source.connectionId)))
      return false;
    const [intake] = await tx
      .select()
      .from(whatsAppIntake)
      .where(
        and(
          eq(whatsAppIntake.businessId, businessId),
          eq(whatsAppIntake.inboxConnectionId, source.connectionId),
        ),
      );
    if (
      !intake?.inboundAt ||
      !intake.echoAt ||
      (intake.gap && intake.gap !== "manual_activity_needs_association")
    )
      return false;
    // Accepted but unprocessed activity must stop dispatch even before the durable worker runs.
    const [pending] = await tx
      .select({ id: whatsAppReceipt.id })
      .from(whatsAppReceipt)
      .where(
        and(
          eq(whatsAppReceipt.connectionId, intake.id),
          eq(whatsAppReceipt.connectionVersion, intake.connectionVersion),
          sql`${whatsAppReceipt.state} IN ('pending','review') AND (${whatsAppReceipt.activity}->>'peer' IS NULL OR ${whatsAppReceipt.activity}->>'peer'=${source.content.senderRef})`,
        ),
      )
      .limit(1);
    if (pending) return false;
  }
  return true;
}
export async function metaManualHistory(
  tx: Transaction,
  businessId: string,
  conversationId: string,
) {
  const [conversation] = await tx
    .select()
    .from(inboxConversation)
    .where(
      and(
        eq(inboxConversation.id, conversationId),
        eq(inboxConversation.businessId, businessId),
      ),
    );
  if (!conversation) return [];
  const [intake] = await tx
    .select()
    .from(whatsAppIntake)
    .where(
      and(
        eq(whatsAppIntake.businessId, businessId),
        eq(whatsAppIntake.inboxConnectionId, conversation.connectionId),
      ),
    );
  if (!intake) return [];
  const rows = await tx
    .select()
    .from(whatsAppReceipt)
    .where(
      and(
        eq(whatsAppReceipt.businessId, businessId),
        eq(whatsAppReceipt.connectionId, intake.id),
        eq(whatsAppReceipt.kind, "app_echo"),
        sql`(${whatsAppReceipt.conversationId}=${conversationId}::uuid OR (${whatsAppReceipt.state}='review' AND ${whatsAppReceipt.activity}->>'peer'=${conversation.providerRef}))`,
      ),
    )
    .orderBy(asc(whatsAppReceipt.at))
    .limit(500);
  return rows.flatMap((r) =>
    r.activity?.kind !== "app_echo"
      ? []
      : [
          {
            id: r.id,
            subject: "WhatsApp Business App outgoing activity",
            text: r.activity.text ?? "Content unavailable",
            from: r.activity.from ?? "",
            to: r.activity.peer ? [r.activity.peer] : [],
            occurredAt: r.activity.occurredAt,
            state:
              r.state === "processed"
                ? ("applied" as const)
                : r.state === "historical"
                  ? ("historical" as const)
                  : ("pending" as const),
            opportunityId: r.opportunityId,
          },
        ],
  );
}
