import { and, desc, eq, inArray } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import type { WorkIdentity } from "../models/discovery";
import type {
  SequenceMailProvider,
  SequencePolicy,
} from "../models/email-sequences";
import type { Clock } from "../models/business";
import type { Transaction } from "./scope";
import { requireCapability } from "./scope";
import { requireSalesSession } from "./sales-session";
import { campaignHash, createCampaignRepository } from "./campaign-repository";
import { identityView } from "./sender-repository";
import { emailDecisionAtDispatch } from "./email-eligibility-context";
import {
  campaignRevision,
  campaignDecision,
  emailHandoff,
  emailHandoffEvidence,
  emailSequencePolicy,
  emailSequenceEvent,
  emailSequenceAction,
  inboxOpportunity,
  senderIdentity,
} from "./schema";

export async function sequencePolicyAt(tx: Transaction, businessId: string) {
  return (
    (
      await tx
        .select()
        .from(emailSequencePolicy)
        .where(eq(emailSequencePolicy.businessId, businessId))
        .orderBy(desc(emailSequencePolicy.version))
        .limit(1)
    )[0] ?? null
  );
}
export async function sequenceUsage(
  tx: Transaction,
  businessId: string,
  policy: SequencePolicy,
) {
  const events = await tx
    .select()
    .from(emailSequenceEvent)
    .where(
      and(
        eq(emailSequenceEvent.businessId, businessId),
        inArray(emailSequenceEvent.kind, [
          "attempt_reserved",
          "dispatch_boundary",
        ]),
      ),
    );
  const reservations = events.filter(
    (e) =>
      e.kind === "attempt_reserved" &&
      e.at >= new Date(policy.periodStart) &&
      e.at < new Date(policy.periodEnd),
  );
  return {
    events,
    reserved: reservations.length,
    remaining: Math.max(0, policy.maxProviderCalls - reservations.length),
  };
}
export function recipientReservedAttempts(
  events: Pick<
    typeof emailSequenceEvent.$inferSelect,
    "kind" | "runId" | "actionId"
  >[],
  runId: string,
  contactId: string,
  actions: Pick<typeof emailSequenceAction.$inferSelect, "id" | "contactId">[],
) {
  const ids = new Set(
    actions.filter((a) => a.contactId === contactId).map((a) => a.id),
  );
  return events.filter(
    (e) =>
      e.runId === runId &&
      e.kind === "attempt_reserved" &&
      e.actionId !== null &&
      ids.has(e.actionId),
  ).length;
}
export async function sequenceRevision(
  tx: Transaction,
  businessId: string,
  id: string,
  payloadHash: string,
) {
  const [r] = await tx
    .select()
    .from(campaignRevision)
    .where(
      and(
        eq(campaignRevision.businessId, businessId),
        eq(campaignRevision.id, id),
      ),
    );
  if (!r) throw new ApplicationError("NOT_FOUND");
  if (r.payloadHash !== payloadHash || campaignHash(r.snapshot) !== payloadHash)
    throw new ApplicationError("CONFLICT");
  return r;
}

/** Every evaluation is transaction-local, under the same Business and market-policy locks as intake, suppression,
 * ownership and sender changes. The result is never a cached dispatch permit. */
type SequenceDispatchContext = {
  actor: WorkIdentity;
  businessId: string;
  revision: Awaited<ReturnType<typeof sequenceRevision>>;
  action: {
    contactId: string;
    stepIndex: number;
    opportunityId: string | null;
    id?: string;
  };
  provider: SequenceMailProvider;
};
export function createSequenceGate(d: {
  campaigns: ReturnType<typeof createCampaignRepository>;
  clock: Clock;
}) {
  const { campaigns, clock } = d;
  return async (tx: Transaction, context: SequenceDispatchContext) => {
    const {
      actor,
      businessId,
      revision: r,
      provider,
      action: { contactId, stepIndex, opportunityId, id: sequenceActionId },
    } = context;
    const role = await requireCapability(tx, actor, businessId, "sales.work");
    await requireSalesSession(tx, actor, clock.now(), role);
    const recipient = r.snapshot.recipients.find(
      (s) => s.contactId === contactId,
    );
    if (!recipient) throw new ApplicationError("CONFLICT");
    if (!r.snapshot.timing) return { reason: "local_timing_required" } as const;
    if (r.snapshot.stopConditions.additional.length)
      return { reason: "additional_stop_review_required" } as const;
    if (opportunityId) {
      const [need] = await tx
        .select()
        .from(inboxOpportunity)
        .where(
          and(
            eq(inboxOpportunity.businessId, businessId),
            eq(inboxOpportunity.id, opportunityId),
          ),
        );
      if (
        !need ||
        need.ownerId !== actor.userId ||
        need.controlState !== "automation"
      )
        return { reason: "human_control" } as const;
      const [action] = sequenceActionId
        ? await tx
            .select()
            .from(emailSequenceAction)
            .where(
              and(
                eq(emailSequenceAction.businessId, businessId),
                eq(emailSequenceAction.id, sequenceActionId),
              ),
            )
        : [];
      if (
        !action ||
        action.opportunityId !== opportunityId ||
        action.controlVersion !== need.controlVersion
      )
        return { reason: "control_changed" } as const;
      const replies = await tx
        .select({ id: emailSequenceEvent.id })
        .from(emailSequenceEvent)
        .innerJoin(
          emailSequenceAction,
          and(
            eq(emailSequenceAction.id, emailSequenceEvent.actionId),
            eq(emailSequenceAction.businessId, businessId),
          ),
        )
        .where(
          and(
            eq(emailSequenceEvent.businessId, businessId),
            eq(emailSequenceAction.opportunityId, opportunityId),
            eq(emailSequenceEvent.kind, "reply_observed"),
          ),
        );
      if (replies.length) return { reason: "buyer_replied" } as const;
      const sent = await tx
        .select({ id: emailSequenceEvent.id })
        .from(emailSequenceEvent)
        .where(
          and(
            eq(emailSequenceEvent.businessId, businessId),
            eq(emailSequenceEvent.actionId, sequenceActionId!),
            eq(emailSequenceEvent.kind, "sent_folder_observed"),
          ),
        );
      if (sent.length && !action.receipt)
        return { reason: "native_send_requires_reconciliation" } as const;
    }
    const review = await campaigns.reviewAt(tx, businessId, role, actor, {
      revisionId: r.id,
      payloadHash: r.payloadHash,
      recipient: {
        prospectId: recipient.prospectId,
        contactId,
        address: recipient.address,
      },
      stepIndex,
      sequenceActionId,
    });
    if (review.approval?.decision !== "approved")
      return { reason: "approval_required" } as const;
    const checks = [
      "version",
      "authority",
      "evidence",
      "sender",
      "reach",
      "conversation",
    ] as const;
    for (const check of checks)
      if (review.current[check].status !== "allowed")
        return { reason: `campaign_${check}_changed` } as const;
    const eligibility = await emailDecisionAtDispatch(
      tx,
      businessId,
      actor.userId,
      review.eligibility,
      clock.now(),
    );
    if (eligibility.status !== "allowed")
      return {
        reason: eligibility.suppressionIds.length
          ? "recipient_suppressed"
          : `email_eligibility_${eligibility.status}`,
      } as const;
    const [identity] = await tx
      .select()
      .from(senderIdentity)
      .where(
        and(
          eq(senderIdentity.businessId, businessId),
          eq(senderIdentity.id, r.snapshot.senderIdentityId),
        ),
      );
    if (!identity) return { reason: "sender_unavailable" } as const;
    const sender = await identityView(tx, businessId, identity, clock.now(), {
      key: provider.key,
      mode: provider.mode,
    });
    if (
      !sender.readiness.uses.first_contact.ready ||
      provider.mode === "unconfigured"
    )
      return { reason: "sender_transport_unavailable" } as const;
    const policy = await sequencePolicyAt(tx, businessId);
    const at = clock.now();
    if (
      !policy?.configuration.enabled ||
      at < new Date(policy.configuration.periodStart) ||
      at >= new Date(policy.configuration.periodEnd) ||
      policy.configuration.adapterKey !== provider.key ||
      policy.configuration.mode !== provider.mode
    )
      return { reason: "sequence_allowance_unavailable" } as const;
    if (stepIndex === 0) {
      const handoffs = await tx
        .select({ kind: emailHandoffEvidence.kind })
        .from(emailHandoff)
        .innerJoin(
          emailHandoffEvidence,
          eq(emailHandoffEvidence.handoffId, emailHandoff.id),
        )
        .where(
          and(
            eq(emailHandoff.businessId, businessId),
            eq(emailHandoff.revisionId, r.id),
            eq(emailHandoff.contactId, contactId),
          ),
        );
      if (handoffs.some((e) => e.kind !== "prepared"))
        return { reason: "manual_send_review_required" } as const;
    }
    const finalAt = clock.now();
    const finalEligibility = await emailDecisionAtDispatch(
      tx,
      businessId,
      actor.userId,
      eligibility,
      finalAt,
    );
    if (
      finalEligibility.status !== "allowed" ||
      !sender.evidence ||
      new Date(sender.evidence.validUntil) <= finalAt ||
      new Date(policy.configuration.periodEnd) <= finalAt
    )
      return { reason: "effective_time_changed" } as const;
    const [approval] = await tx
      .select()
      .from(campaignDecision)
      .where(
        and(
          eq(campaignDecision.businessId, businessId),
          eq(campaignDecision.revisionId, r.id),
        ),
      );
    if (!approval) return { reason: "approval_required" } as const;
    try {
      await requireSalesSession(
        tx,
        { userId: approval.actorId, sessionId: approval.sessionId },
        clock.now(),
        "owner",
      );
    } catch (error: unknown) {
      if (!(error instanceof ApplicationError)) throw error;
      return { reason: "approval_authorization_changed" } as const;
    }
    await requireSalesSession(tx, actor, clock.now(), role);
    return {
      reason: null,
      review,
      eligibility: finalEligibility,
      sender,
      policy: policy.configuration,
    } as const;
  };
}
