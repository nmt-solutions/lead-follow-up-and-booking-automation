import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type { MetaActivity, MetaIntakeView } from "../models/whatsapp-intake";
import { ApplicationError } from "../models/application-error";
import { captureInboxInquiry } from "./inbox-repository";
import { writeControl } from "./opportunity-control-repository";
import {
  metaInboundAllowed,
  metaConnectionAuthorized,
} from "./whatsapp-visibility";
import {
  whatsAppConnection,
  whatsAppIntake,
  whatsAppReceipt,
  inboxConnection,
  inboxMessage,
  inboxMessageLink,
  inboxAssociation,
  inboxOpportunity,
  opportunityControlHistory,
} from "./schema";

export type MetaScope = { id: string; businessId: string; actorId: string };
export async function metaIntakeView(
  tx: Transaction,
  businessId: string,
): Promise<MetaIntakeView> {
  const [row] = await tx
    .select()
    .from(whatsAppIntake)
    .where(eq(whatsAppIntake.businessId, businessId));
  const enabled =
    !!row && (await metaInboundAllowed(tx, businessId, row.inboxConnectionId));
  const [count] = row
    ? await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(whatsAppReceipt)
        .where(
          and(
            eq(whatsAppReceipt.connectionId, row.id),
            eq(whatsAppReceipt.connectionVersion, row.connectionVersion),
            inArray(whatsAppReceipt.state, ["pending", "review"]),
          ),
        )
    : [];
  const receipts = row
    ? await tx
        .select()
        .from(whatsAppReceipt)
        .where(
          and(
            eq(whatsAppReceipt.businessId, businessId),
            eq(whatsAppReceipt.connectionVersion, row.connectionVersion),
          ),
        )
        .orderBy(desc(whatsAppReceipt.at), desc(whatsAppReceipt.id))
        .limit(100)
    : [];
  const [unresolvedCoverage] = row
    ? await tx
        .select({ state: whatsAppReceipt.state })
        .from(whatsAppReceipt)
        .where(
          and(
            eq(whatsAppReceipt.connectionId, row.id),
            eq(whatsAppReceipt.connectionVersion, row.connectionVersion),
            sql`((${whatsAppReceipt.kind}='gap' AND ${whatsAppReceipt.state}<>'historical') OR (${whatsAppReceipt.state}='expired' AND ${whatsAppReceipt.kind}<>'status'))`,
          ),
        )
        .limit(1)
    : [];
  const gap =
    row?.gap ?? (unresolvedCoverage ? "unsupported_event_coverage" : null);
  return {
    enabled,
    inboundObserved: enabled && !!row?.inboundAt,
    manualObserved: enabled && !!row?.echoAt,
    replyVisibility: gap
      ? "gap"
      : enabled && row?.echoAt && !count?.value
        ? "supported_app_events"
        : "unverified",
    gap,
    pending: count?.value ?? 0,
    inboxConnectionId: row?.inboxConnectionId ?? null,
    receiptRetentionSeconds: row?.receiptRetentionSeconds ?? null,
    receipts: receipts.map((r) => ({
      id: r.id,
      kind: r.kind,
      messageRef: r.messageRef,
      state: r.state,
      at: r.at.toISOString(),
      status: r.status,
    })),
  };
}
export function createWhatsAppIntakeRepository(
  database: Database,
  clock: Clock,
) {
  async function authorized<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction) => Promise<T>,
  ) {
    return scoped(
      database,
      actor,
      businessId,
      async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "integrations.manage",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx);
      },
      { lock: true },
    );
  }
  async function current(tx: Transaction, businessId: string, id?: string) {
    const [row] = await tx
      .select()
      .from(whatsAppConnection)
      .where(eq(whatsAppConnection.businessId, businessId));
    if (!row || (id && row.id !== id)) throw new ApplicationError("NOT_FOUND");
    return row;
  }
  async function bound<T>(
    scope: MetaScope,
    operation: (
      tx: Transaction,
      intake: typeof whatsAppIntake.$inferSelect,
      connection: typeof whatsAppConnection.$inferSelect,
    ) => Promise<T>,
  ) {
    return scoped(
      database,
      { userId: scope.actorId },
      scope.businessId,
      async (tx) => {
        await requireCapability(
          tx,
          { userId: scope.actorId },
          scope.businessId,
          "integrations.manage",
        );
        const connection = await current(tx, scope.businessId, scope.id);
        const [intake] = await tx
          .select()
          .from(whatsAppIntake)
          .where(eq(whatsAppIntake.id, scope.id));
        if (
          !intake ||
          intake.actorId !== scope.actorId ||
          intake.connectionVersion !== connection.version ||
          !metaConnectionAuthorized(connection)
        )
          throw new ApplicationError("FORBIDDEN");
        return operation(tx, intake, connection);
      },
      { lock: true },
    );
  }
  async function pause(
    tx: Transaction,
    scope: MetaScope,
    ids: string[],
    reason: string,
    source: string,
    at: Date,
  ) {
    for (const id of new Set(ids)) {
      const [need] = await tx
        .select()
        .from(inboxOpportunity)
        .where(
          and(
            eq(inboxOpportunity.id, id),
            eq(inboxOpportunity.businessId, scope.businessId),
          ),
        );
      if (!need) continue;
      const [applied] = await tx
        .select({ id: opportunityControlHistory.id })
        .from(opportunityControlHistory)
        .where(
          and(
            eq(opportunityControlHistory.opportunityId, id),
            eq(opportunityControlHistory.sourceRef, source),
          ),
        )
        .limit(1);
      if (applied) continue;
      await writeControl(
        tx,
        { userId: scope.actorId },
        scope.businessId,
        need,
        {
          reason,
          nextAction:
            "Review this activity in the shared inbox; explicitly hand this Opportunity back when safe",
        },
        "manual_reply",
        at,
        null,
        source,
        need.ownerId ?? scope.actorId,
      );
    }
  }
  return {
    async purge() {
      await database.execute(
        sql`select public.purge_meta_receipts(${clock.now().toISOString()}::timestamptz)`,
      );
    },
    associate(
      actor: WorkIdentity,
      businessId: string,
      receiptId: string,
      messageId: string,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const [receipt] = await tx
          .select()
          .from(whatsAppReceipt)
          .where(
            and(
              eq(whatsAppReceipt.businessId, businessId),
              eq(whatsAppReceipt.id, receiptId),
            ),
          );
        const [intake] = await tx
          .select()
          .from(whatsAppIntake)
          .where(eq(whatsAppIntake.businessId, businessId));
        const connection = await current(tx, businessId);
        const activity = receipt?.activity;
        if (
          !receipt ||
          !intake ||
          receipt.connectionId !== intake.id ||
          receipt.connectionVersion !== intake.connectionVersion ||
          connection.version !== intake.connectionVersion ||
          connection.status !== "connected" ||
          activity?.kind !== "app_echo" ||
          !connection.coexistenceFinished ||
          connection.observation?.checks.coexistence !== "confirmed" ||
          activity.from !==
            connection.configuration.requestedNumber.replace(/^\+/, "")
        )
          throw new ApplicationError("FORBIDDEN");
        const [anchor] = await tx
          .select({ message: inboxMessage, link: inboxMessageLink })
          .from(inboxMessage)
          .innerJoin(inboxMessageLink, eq(inboxMessage.id, inboxMessageLink.id))
          .where(
            and(
              eq(inboxMessage.businessId, businessId),
              eq(inboxMessage.connectionId, intake.inboxConnectionId),
              eq(inboxMessage.id, messageId),
            ),
          );
        if (
          !anchor?.link.opportunityId ||
          anchor.message.content.senderRef !== activity.peer
        )
          throw new ApplicationError("CONFLICT");
        if (receipt.state === "processed") {
          if (receipt.opportunityId !== anchor.link.opportunityId)
            throw new ApplicationError("CONFLICT");
          return metaIntakeView(tx, businessId);
        }
        await pause(
          tx,
          { id: intake.id, businessId, actorId: actor.userId },
          [anchor.link.opportunityId],
          "Reviewed WhatsApp Business App outgoing activity associated with this purchasing need",
          activity.key,
          clock.now(),
        );
        await tx
          .update(whatsAppReceipt)
          .set({
            state: "processed",
            conversationId: anchor.message.conversationId,
            opportunityId: anchor.link.opportunityId,
          })
          .where(eq(whatsAppReceipt.id, receipt.id));
        const [unresolved] = await tx
          .select({ id: whatsAppReceipt.id })
          .from(whatsAppReceipt)
          .where(
            and(
              eq(whatsAppReceipt.connectionId, intake.id),
              eq(whatsAppReceipt.connectionVersion, intake.connectionVersion),
              eq(whatsAppReceipt.state, "review"),
            ),
          )
          .limit(1);
        if (!unresolved && intake.gap === "manual_activity_needs_association")
          await tx
            .update(whatsAppIntake)
            .set({ gap: null })
            .where(eq(whatsAppIntake.id, intake.id));
        return metaIntakeView(tx, businessId);
      });
    },
    workspace(actor: WorkIdentity, businessId: string) {
      return authorized(actor, businessId, (tx) =>
        metaIntakeView(tx, businessId),
      );
    },
    scope(
      actor: WorkIdentity,
      businessId: string,
      version: number,
      providerKey: string,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        if (row.version !== version) throw new ApplicationError("CONFLICT");
        if (
          row.status !== "connected" ||
          row.providerKey !== providerKey ||
          !row.credentials ||
          !row.assets ||
          !row.observation ||
          new Date(row.observation.validUntil) <= clock.now() ||
          [
            "customer_ownership",
            "permissions",
            "number_verified",
            "number_registered",
          ].some(
            (key) =>
              row.observation?.checks[
                key as keyof typeof row.observation.checks
              ] !== "confirmed",
          )
        )
          throw new ApplicationError("CHANNEL_SETUP_REQUIRED");
        return row;
      });
    },
    enable(
      actor: WorkIdentity,
      businessId: string,
      version: number,
      retention: number,
      providerKey: string,
    ) {
      return authorized(actor, businessId, async (tx) => {
        const row = await current(tx, businessId);
        if (
          row.version !== version ||
          row.providerKey !== providerKey ||
          row.status !== "connected" ||
          !row.credentials ||
          !row.assets
        )
          throw new ApplicationError("CONFLICT");
        const [old] = await tx
          .select()
          .from(whatsAppIntake)
          .where(eq(whatsAppIntake.id, row.id));
        if (old?.connectionVersion === version)
          return metaIntakeView(tx, businessId);
        const accountKey = `${row.assets.wabaId}:${row.assets.phoneNumberId}`;
        const reuse = old?.accountKey === accountKey;
        const inboxId = reuse ? old.inboxConnectionId : randomUUID();
        // Meta message timestamps have whole-second precision.
        const enabledAt = new Date(
          Math.floor(clock.now().getTime() / 1000) * 1000,
        );
        if (reuse)
          await tx
            .update(inboxConnection)
            .set({ active: true })
            .where(eq(inboxConnection.id, inboxId));
        else
          await tx.insert(inboxConnection).values({
            id: inboxId,
            businessId,
            label: "Meta WhatsApp inbound",
            channel: "whatsapp",
            mode: "meta",
            conversationRefs: [],
            active: true,
            manualRepliesObservable: false,
            createdBy: actor.userId,
            createdAt: enabledAt,
          });
        const values = {
          connectionVersion: version,
          accountKey,
          inboxConnectionId: inboxId,
          actorId: actor.userId,
          enabledAt,
          receiptRetentionSeconds: retention,
          inboundAt: null,
          echoAt: null,
          gap: null,
        };
        if (old)
          await tx
            .update(whatsAppIntake)
            .set(values)
            .where(eq(whatsAppIntake.id, row.id));
        else
          await tx
            .insert(whatsAppIntake)
            .values({ id: row.id, businessId, ...values });
        return metaIntakeView(tx, businessId);
      });
    },
    async resolve(
      providerKey: string,
      wabaId: string,
      phoneNumberId: string,
    ): Promise<MetaScope> {
      const rows = await database.execute<{
        id: string;
        business_id: string;
        actor_id: string;
      }>(
        sql`select * from public.resolve_meta_intake(${providerKey},${wabaId},${phoneNumberId})`,
      );
      const row = rows.rows[0];
      if (rows.rows.length !== 1 || !row)
        throw new ApplicationError("FORBIDDEN");
      return { id: row.id, businessId: row.business_id, actorId: row.actor_id };
    },
    async pending(providerKey: string): Promise<MetaScope[]> {
      const rows = await database.execute<{
        id: string;
        business_id: string;
        actor_id: string;
      }>(sql`select * from public.pending_meta_intakes(${providerKey})`);
      return rows.rows.map((r) => ({
        id: r.id,
        businessId: r.business_id,
        actorId: r.actor_id,
      }));
    },
    accept(scope: MetaScope, activities: MetaActivity[]) {
      return bound(scope, async (tx, intake, connection) => {
        if (!connection.assets) throw new ApplicationError("FORBIDDEN");
        const accountKey = `${connection.assets.wabaId}:${connection.assets.phoneNumberId}`;
        for (const candidate of activities) {
          const activity: MetaActivity =
            candidate.kind === "app_echo" &&
            (!connection.coexistenceFinished ||
              connection.observation?.checks.coexistence !== "confirmed" ||
              candidate.from !==
                connection.configuration.requestedNumber.replace(/^\+/, ""))
              ? {
                  ...candidate,
                  kind: "gap",
                  status: "unverified_outgoing_origin",
                }
              : candidate;
          const fingerprint = createHash("sha256")
            .update(JSON.stringify(activity))
            .digest("hex");
          const [seen] = await tx
            .select()
            .from(whatsAppReceipt)
            .where(
              and(
                eq(whatsAppReceipt.connectionId, scope.id),
                eq(whatsAppReceipt.accountKey, accountKey),
                eq(whatsAppReceipt.eventKey, activity.key),
              ),
            );
          if (seen) {
            if (seen.fingerprint !== fingerprint)
              await tx
                .update(whatsAppIntake)
                .set({ gap: "conflicting_provider_identity" })
                .where(eq(whatsAppIntake.id, scope.id));
            continue;
          }
          await tx.insert(whatsAppReceipt).values({
            id: randomUUID(),
            businessId: scope.businessId,
            connectionId: scope.id,
            connectionVersion: intake.connectionVersion,
            accountKey,
            eventKey: activity.key,
            fingerprint,
            activity,
            kind: activity.kind,
            messageRef: activity.messageRef,
            peer: activity.peer,
            replyTo: activity.replyTo,
            status: activity.status,
            state: "pending",
            at: clock.now(),
            expiresAt: new Date(
              clock.now().getTime() + intake.receiptRetentionSeconds * 1000,
            ),
          });
        }
      });
    },
    process(scope: MetaScope) {
      return bound(scope, async (tx, intake, connection) => {
        const at = clock.now();
        const rows = await tx
          .select()
          .from(whatsAppReceipt)
          .where(
            and(
              eq(whatsAppReceipt.connectionId, scope.id),
              eq(whatsAppReceipt.connectionVersion, intake.connectionVersion),
              inArray(whatsAppReceipt.state, ["pending", "review"]),
            ),
          )
          .orderBy(
            sql`CASE WHEN ${whatsAppReceipt.state}='pending' THEN 0 ELSE 1 END`,
            asc(whatsAppReceipt.at),
            asc(whatsAppReceipt.id),
          )
          .limit(500);
        for (const row of rows) {
          const activity = row.activity;
          if (!activity || row.expiresAt <= at) {
            await tx
              .update(whatsAppReceipt)
              .set({ activity: null, state: "expired" })
              .where(eq(whatsAppReceipt.id, row.id));
            await tx
              .update(whatsAppIntake)
              .set({ gap: "unprocessed_event_expired" })
              .where(eq(whatsAppIntake.id, scope.id));
            continue;
          }
          if (new Date(activity.occurredAt) < intake.enabledAt) {
            await tx
              .update(whatsAppReceipt)
              .set({ state: "historical" })
              .where(eq(whatsAppReceipt.id, row.id));
            continue;
          }
          let conversationId: string | null = null;
          let opportunityId: string | null = null;
          let state: typeof row.state = "processed";
          if (
            activity.kind === "incoming" &&
            activity.messageRef &&
            activity.peer &&
            activity.text
          ) {
            if (activity.replyTo) {
              const [parent] = await tx
                .select({ id: inboxMessage.id })
                .from(inboxMessage)
                .where(
                  and(
                    eq(inboxMessage.connectionId, intake.inboxConnectionId),
                    eq(inboxMessage.messageRef, activity.replyTo),
                  ),
                );
              if (!parent) {
                await tx
                  .update(whatsAppReceipt)
                  .set({ state: "review" })
                  .where(eq(whatsAppReceipt.id, row.id));
                continue;
              }
            }
            const result = await captureInboxInquiry(
              tx,
              { userId: scope.actorId },
              scope.businessId,
              intake.inboxConnectionId,
              {
                eventId: activity.key,
                messageRef: activity.messageRef,
                conversationRef: activity.peer,
                senderRef: activity.peer,
                senderName: activity.name ?? activity.peer,
                geography: null,
                kind: "direct_inquiry",
                subject: "WhatsApp purchasing inquiry",
                text: activity.text,
                occurredAt: activity.occurredAt,
                ...(activity.replyTo
                  ? { replyToMessageRef: activity.replyTo }
                  : {}),
              },
              at,
              undefined,
              { connectionId: intake.inboxConnectionId },
            );
            conversationId = result.conversationId;
            await tx
              .update(whatsAppIntake)
              .set({ inboundAt: at })
              .where(eq(whatsAppIntake.id, scope.id));
            if (conversationId) {
              const [m] = await tx
                .select({ opportunityId: inboxMessageLink.opportunityId })
                .from(inboxMessage)
                .innerJoin(
                  inboxMessageLink,
                  eq(inboxMessage.id, inboxMessageLink.id),
                )
                .where(
                  and(
                    eq(inboxMessage.connectionId, intake.inboxConnectionId),
                    eq(inboxMessage.messageRef, activity.messageRef),
                  ),
                );
              opportunityId = m?.opportunityId ?? null;
              // A WhatsApp peer is not a purchasing need. Unquoted future messages require explicit association.
              if (!activity.replyTo)
                await tx
                  .update(inboxAssociation)
                  .set({ defaultOpportunityId: null })
                  .where(eq(inboxAssociation.id, conversationId));
              if (
                /\b(human|person|salesperson|agent)\b/i.test(activity.text) &&
                opportunityId
              )
                await pause(
                  tx,
                  scope,
                  [opportunityId],
                  "Buyer requested a person",
                  activity.key,
                  at,
                );
            }
          } else if (
            activity.kind === "app_echo" &&
            activity.peer &&
            activity.messageRef &&
            connection.coexistenceFinished &&
            connection.observation?.checks.coexistence === "confirmed" &&
            activity.from ===
              connection.configuration.requestedNumber.replace(/^\+/, "")
          ) {
            await tx
              .update(whatsAppIntake)
              .set({ echoAt: at })
              .where(eq(whatsAppIntake.id, scope.id));
            const candidates = await tx
              .select({
                conversationId: inboxMessage.conversationId,
                opportunityId: inboxMessageLink.opportunityId,
              })
              .from(inboxMessage)
              .innerJoin(
                inboxMessageLink,
                eq(inboxMessage.id, inboxMessageLink.id),
              )
              .where(
                and(
                  eq(inboxMessage.connectionId, intake.inboxConnectionId),
                  sql`${inboxMessage.content}->>'senderRef' = ${activity.peer}`,
                  ...(activity.replyTo
                    ? [eq(inboxMessage.messageRef, activity.replyTo)]
                    : []),
                ),
              );
            const ids = [
              ...new Set(
                candidates.flatMap((c) =>
                  c.opportunityId ? [c.opportunityId] : [],
                ),
              ),
            ];
            if (ids.length === 1) {
              conversationId = candidates[0].conversationId;
              opportunityId = ids[0];
              const [lastHandback] = await tx
                .select()
                .from(opportunityControlHistory)
                .where(
                  and(
                    eq(opportunityControlHistory.opportunityId, opportunityId),
                    eq(opportunityControlHistory.command, "handback"),
                  ),
                )
                .orderBy(desc(opportunityControlHistory.at))
                .limit(1);
              if (
                !lastHandback ||
                new Date(activity.occurredAt) > lastHandback.at
              )
                await pause(
                  tx,
                  scope,
                  ids,
                  "Supported WhatsApp Business App outgoing activity observed",
                  activity.key,
                  at,
                );
              else state = "historical";
            } else {
              state = "review";
              await tx
                .update(whatsAppIntake)
                .set({ gap: "manual_activity_needs_association" })
                .where(eq(whatsAppIntake.id, scope.id));
            }
          } else if (activity.kind !== "status") {
            await tx
              .update(whatsAppIntake)
              .set({ gap: "unsupported_event_coverage" })
              .where(eq(whatsAppIntake.id, scope.id));
          }
          await tx
            .update(whatsAppReceipt)
            .set({ state, conversationId, opportunityId })
            .where(eq(whatsAppReceipt.id, row.id));
        }
        // Minimize private provider staging data after the Business-selected retention period.
        await tx
          .update(whatsAppReceipt)
          .set({ activity: null })
          .where(
            and(
              eq(whatsAppReceipt.businessId, scope.businessId),
              sql`${whatsAppReceipt.expiresAt} <= ${at.toISOString()}::timestamptz`,
            ),
          );
        return { processed: rows.length };
      });
    },
  };
}
