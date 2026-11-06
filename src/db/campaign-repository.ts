import { createHash, randomUUID } from "node:crypto";
import {
  campaignSaveDisposition,
  selectCampaignRecipients,
  requireCampaignOwner,
  campaignDecisionDisposition,
  campaignEvidenceCurrent,
  campaignSenderUnchanged,
  requireCampaignApprovalContext,
  campaignAuthorityCheck,
} from "../application/campaign-policy";
import { and, asc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type { BusinessRole } from "../models/team";
import { ApplicationError } from "../models/application-error";
import {
  campaignSnapshotSchema,
  campaignProspectSchema,
  type CampaignWorkspace,
  type SaveCampaign,
  type DecideCampaign,
  type inspectCampaignSchema,
  type campaignCurrentSchema,
} from "../models/campaigns";
import type { Database } from "./runtime";
import { requireCapability, scoped, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import { discoveryEvidenceAt } from "./discovery-repository";
import { settings } from "./discovery-state";
import { availableMarkets } from "../discovery/repository";
import { readCommercialPolicy } from "./commercial-authority-repository";
import { identityView, inspectionAt } from "./sender-repository";
import { evaluateEmailAction } from "./email-eligibility-context";
import { firstOutreachConversationState } from "./opportunity-followups";
import { emailDecisionAtDispatch } from "./email-eligibility-context";
import type { CampaignReview } from "../models/campaigns";
import { contactClassification } from "../discovery/evidence";
import {
  campaignRevision,
  campaignDecision,
  senderIdentity,
  user,
} from "./schema";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const campaignHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export async function campaignCandidates(
  tx: Transaction,
  businessId: string,
  at: Date,
) {
  const { prospects } = await discoveryEvidenceAt(tx, businessId, at);
  return prospects.flatMap((p) =>
    p.contacts.flatMap((contact) => {
      if (!contact.id || contact.route?.kind !== "email") return [];
      const prospect = campaignProspectSchema.strip().parse(p);
      const selected = {
        prospectId: p.id,
        contactId: contact.id,
        address: contact.route.value.toLowerCase(),
        contact,
        contactStatus:
          contactClassification(contact) === "buyer_contact"
            ? ("buyer_contact" as const)
            : ("general_business_contact" as const),
        prospect,
        reviewReasons: p.reviewReasons,
      };
      return [{ ...selected, evidenceKey: campaignHash(selected) }];
    }),
  );
}

export function createCampaignRepository(database: Database, clock: Clock) {
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction, role: BusinessRole) => Promise<T>,
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
          "sales.work",
        );
        await requireSalesSession(tx, actor, clock.now(), role);
        return operation(tx, role);
      },
      { lock: true },
    );
  }
  const revisions = (tx: Transaction, businessId: string) =>
    tx
      .select()
      .from(campaignRevision)
      .where(eq(campaignRevision.businessId, businessId))
      .orderBy(asc(campaignRevision.version), asc(campaignRevision.at));
  async function actorName(tx: Transaction, actor: WorkIdentity) {
    const [u] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actor.userId));
    if (!u) throw new ApplicationError("UNAUTHENTICATED");
    return u.name;
  }
  async function workspace(
    tx: Transaction,
    businessId: string,
    role: string,
    actorId: string,
  ): Promise<CampaignWorkspace> {
    const all = await revisions(tx, businessId);
    const decisions = await tx
      .select()
      .from(campaignDecision)
      .where(eq(campaignDecision.businessId, businessId));
    const senders = await tx
      .select()
      .from(senderIdentity)
      .where(eq(senderIdentity.businessId, businessId));
    const candidates = await campaignCandidates(tx, businessId, clock.now());
    const authority = await readCommercialPolicy(tx, businessId, false);
    const { profile, policy } = await settings(tx, businessId),
      markets = availableMarkets(profile, policy);
    const views: CampaignWorkspace["campaigns"][number]["revisions"] = [];
    for (const r of all) {
      const d = decisions.find((d) => d.revisionId === r.id);
      let authorized = false;
      if (d?.decision === "approved") {
        try {
          const original = { userId: d.actorId, sessionId: d.sessionId };
          authorized = authority.approvers.some(
            (a) => a.userId === d.actorId && a.role === "owner",
          );
          if (authorized)
            await requireSalesSession(tx, original, clock.now(), "owner");
        } catch (error: unknown) {
          if (!(error instanceof ApplicationError)) throw error;
          authorized = false;
        }
      }
      const latest = !all.some(
        (v) => v.campaignId === r.campaignId && v.version > r.version,
      );
      const sender = senders.find((s) => s.id === r.snapshot.senderIdentityId);
      const senderState = sender
        ? await identityView(tx, businessId, sender, clock.now())
        : null;
      const inspection = sender
        ? await inspectionAt(tx, businessId, sender, clock.now())
        : null;
      const senderUnchanged = campaignSenderUnchanged(
        r.snapshot,
        sender,
        inspection?.binding ?? null,
      );
      const senderReady = Boolean(
        senderState?.readiness.uses.first_contact.ready && senderUnchanged,
      );
      const evidenceCurrent =
        campaignEvidenceCurrent(r.snapshot, candidates) &&
        r.snapshot.recipients.every(
          (s) => !s.reviewReasons.length && !s.prospect.identityConflict,
        );
      const current: z.infer<typeof campaignCurrentSchema> = {
        version: {
          status: latest ? "allowed" : "blocked",
          reason: latest
            ? "This is the current campaign version."
            : "A later campaign version requires its own approval. The prior approval remains in history.",
        },
        authority: campaignAuthorityCheck(
          d?.decision === "approved",
          authorized,
          authority.version,
          r.snapshot.authorityVersion,
        ),
        evidence: {
          status: evidenceCurrent ? "allowed" : "blocked",
          reason: evidenceCurrent
            ? "The exact selected contact evidence is still current."
            : "Selected contact evidence changed or needs review. Save and approve a new version.",
        },
        sender: {
          status: senderReady ? "allowed" : "blocked",
          reason: senderReady
            ? "The selected identity is currently ready for first contact."
            : "Review the selected Sending identity, transport, health and reply visibility.",
        },
        reach: {
          status: r.snapshot.recipients.every((s) =>
            markets.includes(s.prospect.market),
          )
            ? "allowed"
            : "blocked",
          reason:
            "New-prospect campaigns require current configured Geographic reach for every selected market.",
        },
        conversation: await firstOutreachConversationState(
          tx,
          businessId,
          r.snapshot.recipients.map((r) => r.address),
        ),
        policyVersion: authority.version,
        approvalPolicyVersion: r.snapshot.authorityVersion,
      };
      views.push({
        id: r.id,
        campaignId: r.campaignId,
        version: r.version,
        payloadHash: r.payloadHash,
        snapshot: r.snapshot,
        actorId: r.actorId,
        actorName: r.actorName,
        at: r.at.toISOString(),
        note: r.note,
        current,
        decision: d
          ? {
              decision: d.decision,
              actorId: d.actorId,
              actorName: d.actorName,
              role: d.role,
              at: d.at.toISOString(),
              note: d.note,
            }
          : null,
      });
    }
    return {
      actorId,
      canApprove: role === "owner",
      candidates,
      senders: senders.map((s) => ({
        id: s.id,
        version: s.version,
        configuration: s.configuration,
      })),
      campaigns: [...new Set(views.map((r) => r.campaignId))].map((id) => ({
        id,
        revisions: views.filter((r) => r.campaignId === id),
      })),
    };
  }
  async function review(
    tx: Transaction,
    businessId: string,
    role: string,
    actor: WorkIdentity,
    input: z.infer<typeof inspectCampaignSchema>,
  ) {
    const state = await workspace(tx, businessId, role, actor.userId),
      r = state.campaigns
        .flatMap((c) => c.revisions)
        .find((r) => r.id === input.revisionId);
    if (!r) throw new ApplicationError("NOT_FOUND");
    if (
      r.payloadHash !== input.payloadHash ||
      campaignHash(r.snapshot) !== r.payloadHash
    )
      throw new ApplicationError("CONFLICT");
    const selected = r.snapshot.recipients.find(
      (s) =>
        s.prospectId === input.recipient.prospectId &&
        s.contactId === input.recipient.contactId &&
        s.address === input.recipient.address,
    );
    if (!selected) throw new ApplicationError("CONFLICT");
    const step = r.snapshot.steps[input.stepIndex];
    if (!step || input.stepIndex >= r.snapshot.maxAttempts)
      throw new ApplicationError("INVALID_INPUT");
    const eligibility = await evaluateEmailAction(
      tx,
      businessId,
      {
        kind: "campaign",
        id: r.id,
        recipientKey: selected.contactId,
        stepIndex: input.stepIndex,
      },
      actor.userId,
      clock.now(),
    );
    return {
      revision: r,
      approval: r.decision,
      current: r.current,
      recipient: selected,
      step,
      stepIndex: input.stepIndex,
      eligibility,
      execution: {
        configured: false as const,
        state: "not_scheduled" as const,
      },
    };
  }
  return {
    /** Keep approval and current safety checks under the shared Business/policy guard through local preparation. */
    withApprovedAction<T>(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof inspectCampaignSchema>,
      run: (tx: Transaction, review: CampaignReview) => Promise<T>,
    ) {
      return scope(actor, businessId, async (tx, role) => {
        async function requireCurrent() {
          await requireSalesSession(tx, actor, clock.now(), role);
          const result = await review(tx, businessId, role, actor, input);
          if (
            result.approval?.decision !== "approved" ||
            [
              result.current.version,
              result.current.authority,
              result.current.evidence,
              result.current.sender,
              result.current.reach,
              result.current.conversation,
            ].some((c) => c.status !== "allowed")
          )
            throw new ApplicationError("CONFLICT");
          const eligibility = await emailDecisionAtDispatch(
            tx,
            businessId,
            actor.userId,
            result.eligibility,
            clock.now(),
          );
          if (eligibility.status !== "allowed")
            throw new ApplicationError("CONFLICT");
          return { ...result, eligibility };
        }
        const result = await run(tx, await requireCurrent());
        // Time can cross an expiry/effective boundary while local persistence waits, even with concurrent writers fenced out.
        await requireCurrent();
        return result;
      });
    },
    workspace(actor: WorkIdentity, businessId: string) {
      return scope(actor, businessId, (tx, role) =>
        workspace(tx, businessId, role, actor.userId),
      );
    },
    save(actor: WorkIdentity, businessId: string, input: SaveCampaign) {
      return scope(actor, businessId, async (tx, role) => {
        const all = await revisions(tx, businessId),
          fingerprint = campaignHash(input);
        if (
          campaignSaveDisposition(actor.userId, input, all, fingerprint) ===
          "replay"
        )
          return workspace(tx, businessId, role, actor.userId);
        const candidates = await campaignCandidates(
          tx,
          businessId,
          clock.now(),
        );
        const selected = selectCampaignRecipients(input, candidates);
        const [sender] = await tx
          .select()
          .from(senderIdentity)
          .where(
            and(
              eq(senderIdentity.businessId, businessId),
              eq(senderIdentity.id, input.senderIdentityId),
            ),
          );
        if (!sender) throw new ApplicationError("NOT_FOUND");
        if (sender.version !== input.senderVersion)
          throw new ApplicationError("CONFLICT");
        const inspection = await inspectionAt(
          tx,
          businessId,
          sender,
          clock.now(),
        );
        const senderContext = {
          binding: inspection.binding,
          connection: inspection.connection,
          replyRoute: inspection.replyRoute,
          replyConnection: inspection.replyConnection,
        };
        const snapshot = campaignSnapshotSchema.parse({
          name: input.name,
          channel: input.channel,
          senderIdentityId: sender.id,
          senderVersion: sender.version,
          sender: sender.configuration,
          senderContext,
          authorityVersion: (await readCommercialPolicy(tx, businessId, false))
            .version,
          recipients: selected,
          steps: input.steps,
          maxAttempts: input.maxAttempts,
          stopConditions: input.stopConditions,
        });
        await tx.insert(campaignRevision).values({
          id: randomUUID(),
          businessId,
          campaignId: input.campaignId,
          version: input.expectedVersion + 1,
          requestKey: input.requestKey,
          fingerprint,
          payloadHash: campaignHash(snapshot),
          snapshot,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          actorName: await actorName(tx, actor),
          note: input.note,
          at: clock.now(),
        });
        return workspace(tx, businessId, role, actor.userId);
      });
    },
    decide(actor: WorkIdentity, businessId: string, input: DecideCampaign) {
      return scope(actor, businessId, async (tx, role) => {
        requireCampaignOwner(role);
        const all = await revisions(tx, businessId),
          r = all.find((r) => r.id === input.revisionId);
        if (!r) throw new ApplicationError("NOT_FOUND");
        const [seen] = await tx
          .select()
          .from(campaignDecision)
          .where(
            and(
              eq(campaignDecision.businessId, businessId),
              eq(campaignDecision.revisionId, r.id),
            ),
          );
        if (
          campaignDecisionDisposition(
            actor.userId,
            input,
            r,
            seen,
            all,
            campaignHash(r.snapshot),
          ) === "replay"
        )
          return workspace(tx, businessId, role, actor.userId);
        if (input.decision === "approved") {
          const candidates = await campaignCandidates(
            tx,
            businessId,
            clock.now(),
          );
          const [sender] = await tx
            .select()
            .from(senderIdentity)
            .where(
              and(
                eq(senderIdentity.businessId, businessId),
                eq(senderIdentity.id, r.snapshot.senderIdentityId),
              ),
            );
          const inspection = sender
            ? await inspectionAt(tx, businessId, sender, clock.now())
            : null;
          requireCampaignApprovalContext(
            r.snapshot,
            candidates,
            (await readCommercialPolicy(tx, businessId, false)).version,
            campaignSenderUnchanged(
              r.snapshot,
              sender,
              inspection?.binding ?? null,
            ),
          );
        }
        await tx.insert(campaignDecision).values({
          id: randomUUID(),
          businessId,
          revisionId: r.id,
          payloadHash: r.payloadHash,
          decision: input.decision,
          actorId: actor.userId,
          sessionId: actor.sessionId,
          actorName: await actorName(tx, actor),
          role: "owner",
          note: input.note,
          at: clock.now(),
        });
        return workspace(tx, businessId, role, actor.userId);
      });
    },
    review(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof inspectCampaignSchema>,
    ) {
      return scope(actor, businessId, (tx, role) =>
        review(tx, businessId, role, actor, input),
      );
    },
    /** Inspection is an approval-consumption contract, never a dispatch grant. */
    inspect(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof inspectCampaignSchema>,
    ) {
      return scope(actor, businessId, async (tx, role) => {
        const result = await review(tx, businessId, role, actor, input);
        if (result.approval?.decision !== "approved")
          throw new ApplicationError("CONFLICT");
        return { ...result, approval: result.approval };
      });
    },
  };
}
