import { and, asc, eq, sql } from "drizzle-orm";
import type { Transaction } from "./scope";
import { resolveMetaOutgoing } from "./whatsapp-references";
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

export function metaConnectionAuthorized(
  connection: typeof whatsAppConnection.$inferSelect,
) {
  const checks = connection.observation?.checks;
  return (
    connection.status === "connected" &&
    !!connection.credentials &&
    !!checks &&
    checks.customer_ownership === "confirmed" &&
    checks.permissions === "confirmed" &&
    checks.number_verified === "confirmed" &&
    checks.number_registered === "confirmed"
  );
}

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
    metaConnectionAuthorized(r.connection)
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
      (intake.gap &&
        ![
          "manual_activity_needs_association",
          "unsupported_event_coverage",
          "unprocessed_event_expired",
        ].includes(intake.gap))
    )
      return false;
    // Accepted but unprocessed activity must stop dispatch even before the durable worker runs.
    const pending = await tx
      .select()
      .from(whatsAppReceipt)
      .where(
        and(
          eq(whatsAppReceipt.connectionId, intake.id),
          eq(whatsAppReceipt.connectionVersion, intake.connectionVersion),
          sql`(${whatsAppReceipt.state} IN ('pending','review','expired') OR (${whatsAppReceipt.kind}='gap' AND ${whatsAppReceipt.state}<>'historical')) AND ${whatsAppReceipt.kind}<>'status' AND (${whatsAppReceipt.peer} IS NULL OR ${whatsAppReceipt.peer}=${source.content.senderRef})`,
        ),
      );
    for (const receipt of pending) {
      if (
        receipt.kind === "app_echo" &&
        receipt.messageRef &&
        receipt.activity?.text
      ) {
        const origin = await resolveMetaOutgoing(
          tx,
          businessId,
          source.connectionId,
          source.content.senderRef,
          receipt.messageRef,
        );
        if (origin?.body === receipt.activity.text) continue;
      }
      if (!receipt.replyTo) return false;
      const [anchor] = await tx
        .select({ opportunityId: inboxMessageLink.opportunityId })
        .from(inboxMessage)
        .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
        .where(
          and(
            eq(inboxMessage.businessId, businessId),
            eq(inboxMessage.connectionId, source.connectionId),
            eq(inboxMessage.messageRef, receipt.replyTo),
            sql`${inboxMessage.content}->>'senderRef'=${source.content.senderRef}`,
          ),
        );
      // A known exact reference fences its need. Unresolved references still fence the peer.
      const outgoing = !anchor?.opportunityId
        ? await resolveMetaOutgoing(
            tx,
            businessId,
            source.connectionId,
            source.content.senderRef,
            receipt.replyTo,
          )
        : null;
      const referencedNeed = anchor?.opportunityId ?? outgoing?.opportunityId;
      if (!referencedNeed || referencedNeed === opportunityId) return false;
    }
  }
  return true;
}
/** Same need/peer fencing for an approved prospect that has no incoming-message row yet. */
export async function metaPeerVisible(
  tx: Transaction,
  businessId: string,
  connectionId: string,
  peer: string,
  opportunityId: string,
) {
  if (!(await metaInboundAllowed(tx, businessId, connectionId))) return false;
  const [intake] = await tx
    .select()
    .from(whatsAppIntake)
    .where(
      and(
        eq(whatsAppIntake.businessId, businessId),
        eq(whatsAppIntake.inboxConnectionId, connectionId),
      ),
    );
  if (
    !intake?.inboundAt ||
    !intake.echoAt ||
    (intake.gap &&
      ![
        "manual_activity_needs_association",
        "unsupported_event_coverage",
        "unprocessed_event_expired",
      ].includes(intake.gap))
  )
    return false;
  const pending = await tx
    .select()
    .from(whatsAppReceipt)
    .where(
      and(
        eq(whatsAppReceipt.connectionId, intake.id),
        eq(whatsAppReceipt.connectionVersion, intake.connectionVersion),
        sql`(${whatsAppReceipt.state} IN ('pending','review','expired') OR (${whatsAppReceipt.kind}='gap' AND ${whatsAppReceipt.state}<>'historical')) AND ${whatsAppReceipt.kind}<>'status' AND (${whatsAppReceipt.peer} IS NULL OR ${whatsAppReceipt.peer}=${peer})`,
      ),
    );
  for (const r of pending) {
    if (r.kind === "app_echo" && r.messageRef && r.activity?.text) {
      const origin = await resolveMetaOutgoing(
        tx,
        businessId,
        connectionId,
        peer,
        r.messageRef,
      );
      if (origin?.body === r.activity.text) continue;
    }
    if (!r.replyTo) return false;
    const [parent] = await tx
      .select({ opportunityId: inboxMessageLink.opportunityId })
      .from(inboxMessage)
      .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
      .where(
        and(
          eq(inboxMessage.businessId, businessId),
          eq(inboxMessage.connectionId, connectionId),
          eq(inboxMessage.messageRef, r.replyTo),
          sql`${inboxMessage.content}->>'senderRef'=${peer}`,
        ),
      );
    const outgoing = !parent?.opportunityId
      ? await resolveMetaOutgoing(tx, businessId, connectionId, peer, r.replyTo)
      : null;
    const need = parent?.opportunityId ?? outgoing?.opportunityId;
    if (!need || need === opportunityId) return false;
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
