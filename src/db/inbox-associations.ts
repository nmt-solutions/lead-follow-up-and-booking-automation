import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  planInquiryAssociation,
  purchasingNeedDefaults,
} from "../application/inbox-association";
import type { InboxRepository } from "../application/inbox";
import { ApplicationError } from "../models/application-error";
import type {
  InboxBuyer,
  InboxOpportunity,
  InboxSummary,
  InboxConnection,
  OpportunityHistoryEntry,
  InboxDiscoverySource,
} from "../models/inbox";
import { persistedProspectSchema } from "../models/discovery";
import type { Database } from "./runtime";
import { scoped, requireCapability, type Transaction } from "./scope";
import {
  inboxAssociation,
  inboxAssociationHistory,
  inboxBuyer,
  inboxConnection,
  inboxConversation,
  inboxMessage,
  inboxMessageLink,
  inboxOpportunity,
  inboxOpportunityHistory,
  user,
  discoveryObservation,
} from "./schema";

export function connectionView(
  row: typeof inboxConnection.$inferSelect,
): InboxConnection {
  return {
    id: row.id,
    label: row.label,
    channel: row.channel,
    conversationRefs: row.conversationRefs,
    active: row.active,
    manualRepliesObservable: row.manualRepliesObservable,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
  };
}
function buyerView(row: typeof inboxBuyer.$inferSelect): InboxBuyer {
  return {
    id: row.id,
    name: row.name,
    senderRef: row.senderRef,
    geography: row.geography,
    relationship: "engaged",
  };
}
function opportunityView(
  row: typeof inboxOpportunity.$inferSelect,
  history: OpportunityHistoryEntry[],
  sources: InboxDiscoverySource[],
): InboxOpportunity {
  if (!row.buyerId) throw new ApplicationError("CONFLICT");
  return {
    id: row.id,
    buyerId: row.buyerId,
    title: row.title,
    stage: row.stage,
    ownerId: row.ownerId,
    handoffReason: row.handoffReason,
    nextAction: row.nextAction,
    createdAt: row.createdAt.toISOString(),
    history,
    sources,
  };
}
async function discoverySources(
  tx: Transaction,
  businessId: string,
): Promise<InboxDiscoverySource[]> {
  const rows = await tx
    .select()
    .from(discoveryObservation)
    .where(eq(discoveryObservation.businessId, businessId))
    .orderBy(
      desc(discoveryObservation.checkedAt),
      asc(discoveryObservation.id),
    );
  return rows.map((row) => {
    const parsed = persistedProspectSchema.safeParse(row.data);
    if (!parsed.success) throw new ApplicationError("CONFLICT");
    return {
      observationId: row.id,
      prospectId: row.prospectId,
      runId: row.runId,
      name: parsed.data.name,
      matchReason: parsed.data.matchReason,
      uncertainty: parsed.data.uncertainty,
      evidence: parsed.data.evidence.map((entry) => ({
        url: entry.url,
        quote: entry.quote,
        checkedAt: entry.checkedAt,
      })),
    };
  });
}
async function opportunitySources(
  tx: Transaction,
  businessId: string,
  sources: InboxDiscoverySource[],
) {
  const rows = await tx
    .select()
    .from(inboxAssociationHistory)
    .where(eq(inboxAssociationHistory.businessId, businessId));
  return (id: string) =>
    sources.filter((source) =>
      rows.some(
        (entry) =>
          entry.discoveryObservationId === source.observationId &&
          entry.after.messages.some((link) => link.opportunityId === id),
      ),
    );
}
async function opportunityHistory(tx: Transaction, businessId: string) {
  const rows = await tx
    .select()
    .from(inboxOpportunityHistory)
    .where(eq(inboxOpportunityHistory.businessId, businessId))
    .orderBy(asc(inboxOpportunityHistory.at), asc(inboxOpportunityHistory.id));
  return (id: string): OpportunityHistoryEntry[] =>
    rows
      .filter((row) => row.opportunityId === id)
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        detail: row.detail,
        actorId: row.actorId,
        sourceRef: row.sourceRef,
        at: row.at.toISOString(),
      }));
}
async function summaries(
  tx: Transaction,
  businessId: string,
): Promise<InboxSummary[]> {
  const rows = await tx
    .select({
      conversation: inboxConversation,
      buyer: inboxBuyer,
      connection: inboxConnection,
      association: inboxAssociation,
    })
    .from(inboxConversation)
    .innerJoin(inboxAssociation, eq(inboxAssociation.id, inboxConversation.id))
    .innerJoin(inboxBuyer, eq(inboxBuyer.id, inboxAssociation.buyerId))
    .innerJoin(
      inboxConnection,
      eq(inboxConnection.id, inboxConversation.connectionId),
    )
    .where(eq(inboxConversation.businessId, businessId))
    .orderBy(desc(inboxConversation.lastReceivedAt), asc(inboxConversation.id));
  return rows.map((row) => ({
    id: row.conversation.id,
    subject: row.conversation.subject,
    buyerName: row.buyer.name,
    buyerId: row.buyer.id,
    channel: row.connection.channel,
    opportunityId: row.association.defaultOpportunityId,
    needsReview: !!row.association.reviewReason,
    lastReceivedAt: row.conversation.lastReceivedAt.toISOString(),
  }));
}
export function createAssociationRepository(
  database: Database,
): Pick<InboxRepository, "workspace" | "conversation" | "associate"> {
  return {
    workspace(actor, businessId) {
      return scoped(database, actor, businessId, async (tx) => {
        const role = await requireCapability(
          tx,
          actor,
          businessId,
          "sales.work",
        );
        const connections = await tx
          .select()
          .from(inboxConnection)
          .where(eq(inboxConnection.businessId, businessId))
          .orderBy(desc(inboxConnection.createdAt), asc(inboxConnection.id));
        const buyers = await tx
          .select()
          .from(inboxBuyer)
          .where(eq(inboxBuyer.businessId, businessId))
          .orderBy(asc(inboxBuyer.name), asc(inboxBuyer.id));
        const needs = await tx
          .select()
          .from(inboxOpportunity)
          .where(eq(inboxOpportunity.businessId, businessId))
          .orderBy(asc(inboxOpportunity.createdAt), asc(inboxOpportunity.id));
        const history = await opportunityHistory(tx, businessId);
        const sources = await discoverySources(tx, businessId);
        const attached = await opportunitySources(tx, businessId, sources);
        return {
          canManage: role !== "salesperson",
          connections: connections.map(connectionView),
          buyers: buyers.map(buyerView),
          opportunities: needs.map((need) =>
            opportunityView(need, history(need.id), attached(need.id)),
          ),
          discoverySources: sources,
          conversations: await summaries(tx, businessId),
        };
      });
    },
    conversation(actor, businessId, id) {
      return scoped(database, actor, businessId, async (tx) => {
        await requireCapability(tx, actor, businessId, "sales.work");
        const [row] = await tx
          .select({
            conversation: inboxConversation,
            association: inboxAssociation,
            connection: inboxConnection,
            originalBuyer: inboxBuyer,
            initial: inboxOpportunity,
          })
          .from(inboxConversation)
          .innerJoin(
            inboxAssociation,
            eq(inboxAssociation.id, inboxConversation.id),
          )
          .innerJoin(
            inboxConnection,
            eq(inboxConnection.id, inboxConversation.connectionId),
          )
          .innerJoin(inboxBuyer, eq(inboxBuyer.id, inboxConversation.buyerId))
          .innerJoin(
            inboxOpportunity,
            eq(inboxOpportunity.id, inboxAssociation.initialOpportunityId),
          )
          .where(
            and(
              eq(inboxConversation.businessId, businessId),
              eq(inboxConversation.id, id),
            ),
          );
        if (!row) throw new ApplicationError("NOT_FOUND");
        const [reviewOwner] = await tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, row.association.reviewOwnerId));
        const outcomeHistory = await opportunityHistory(tx, businessId);
        const sources = await opportunitySources(
          tx,
          businessId,
          await discoverySources(tx, businessId),
        );
        const [buyer] = await tx
          .select()
          .from(inboxBuyer)
          .where(
            and(
              eq(inboxBuyer.id, row.association.buyerId),
              eq(inboxBuyer.businessId, businessId),
            ),
          );
        if (!buyer) throw new ApplicationError("NOT_FOUND");
        const needs = await tx
          .select()
          .from(inboxOpportunity)
          .where(
            and(
              eq(inboxOpportunity.businessId, businessId),
              eq(inboxOpportunity.buyerId, buyer.id),
            ),
          )
          .orderBy(asc(inboxOpportunity.createdAt), asc(inboxOpportunity.id));
        const messages = await tx
          .select({
            message: inboxMessage,
            opportunityId: inboxMessageLink.opportunityId,
          })
          .from(inboxMessage)
          .innerJoin(inboxMessageLink, eq(inboxMessageLink.id, inboxMessage.id))
          .where(
            and(
              eq(inboxMessage.businessId, businessId),
              eq(inboxMessage.conversationId, id),
            ),
          )
          .orderBy(
            asc(inboxMessageLink.sequence),
            asc(inboxMessage.receivedAt),
            asc(inboxMessage.id),
          );
        const history = await tx
          .select()
          .from(inboxAssociationHistory)
          .where(
            and(
              eq(inboxAssociationHistory.businessId, businessId),
              eq(inboxAssociationHistory.conversationId, id),
            ),
          )
          .orderBy(
            asc(inboxAssociationHistory.version),
            asc(inboxAssociationHistory.at),
            asc(inboxAssociationHistory.id),
          );
        return {
          id,
          subject: row.conversation.subject,
          providerRef: row.conversation.providerRef,
          connection: connectionView(row.connection),
          buyer: buyerView(buyer),
          originalBuyer: buyerView(row.originalBuyer),
          opportunity: opportunityView(
            row.initial,
            outcomeHistory(row.initial.id),
            sources(row.initial.id),
          ),
          opportunities: needs.map((need) =>
            opportunityView(need, outcomeHistory(need.id), sources(need.id)),
          ),
          association: {
            version: row.association.version,
            defaultOpportunityId: row.association.defaultOpportunityId,
            reviewReason: row.association.reviewReason,
            reviewOwnerId: row.association.reviewOwnerId,
            reviewOwnerName: reviewOwner?.name ?? row.association.reviewOwnerId,
            nextAction: row.association.nextAction,
          },
          buyerConversations: (await summaries(tx, businessId)).filter(
            (conversation) => conversation.buyerId === buyer.id,
          ),
          messages: messages.map(({ message, opportunityId }) => ({
            ...message.content,
            id: message.id,
            receivedAt: message.receivedAt.toISOString(),
            opportunityId,
          })),
          history: history.map((entry) => ({
            ...entry,
            at: entry.at.toISOString(),
          })),
        };
      });
    },
    associate(actor, businessId, id, input, at) {
      return scoped(
        database,
        actor,
        businessId,
        async (tx) => {
          await requireCapability(tx, actor, businessId, "sales.work");
          const [state] = await tx
            .select()
            .from(inboxAssociation)
            .where(
              and(
                eq(inboxAssociation.businessId, businessId),
                eq(inboxAssociation.id, id),
              ),
            );
          if (!state) throw new ApplicationError("NOT_FOUND");
          if (state.version !== input.expectedVersion)
            throw new ApplicationError("CONFLICT");
          const [buyer] = await tx
            .select()
            .from(inboxBuyer)
            .where(
              and(
                eq(inboxBuyer.businessId, businessId),
                eq(inboxBuyer.id, input.buyerId),
              ),
            );
          if (!buyer) throw new ApplicationError("NOT_FOUND");
          if (input.discoveryObservationId) {
            const [source] = await tx
              .select({ id: discoveryObservation.id })
              .from(discoveryObservation)
              .where(
                and(
                  eq(discoveryObservation.id, input.discoveryObservationId),
                  eq(discoveryObservation.businessId, businessId),
                ),
              );
            if (!source) throw new ApplicationError("NOT_FOUND");
          }
          const links = await tx
            .select()
            .from(inboxMessageLink)
            .where(
              and(
                eq(inboxMessageLink.businessId, businessId),
                eq(inboxMessageLink.conversationId, id),
              ),
            );
          let opportunityId: string | null = null;
          if (input.target.kind === "existing") {
            const [need] = await tx
              .select()
              .from(inboxOpportunity)
              .where(
                and(
                  eq(inboxOpportunity.businessId, businessId),
                  eq(inboxOpportunity.id, input.target.opportunityId),
                  eq(inboxOpportunity.buyerId, buyer.id),
                ),
              );
            if (!need) throw new ApplicationError("NOT_FOUND");
            opportunityId = need.id;
          }
          if (input.target.kind === "new") {
            opportunityId = randomUUID();
            await tx.insert(inboxOpportunity).values({
              id: opportunityId,
              businessId,
              buyerId: buyer.id,
              title: input.target.title,
              ...purchasingNeedDefaults(),
              createdAt: at,
            });
          }
          const plan = planInquiryAssociation(
            state,
            links,
            input,
            opportunityId,
            actor.userId,
          );
          await tx
            .update(inboxMessageLink)
            .set({ opportunityId })
            .where(
              and(
                eq(inboxMessageLink.businessId, businessId),
                eq(inboxMessageLink.conversationId, id),
                inArray(inboxMessageLink.id, plan.selectedIds),
              ),
            );
          await tx
            .update(inboxAssociation)
            .set(plan.state)
            .where(
              and(
                eq(inboxAssociation.id, id),
                eq(inboxAssociation.businessId, businessId),
              ),
            );
          await tx.insert(inboxAssociationHistory).values({
            id: randomUUID(),
            businessId,
            conversationId: id,
            version: state.version + 1,
            actorId: actor.userId,
            reason: input.reason,
            discoveryObservationId: input.discoveryObservationId,
            before: plan.before,
            after: plan.after,
            at,
          });
        },
        { lock: true },
      );
    },
  };
}
