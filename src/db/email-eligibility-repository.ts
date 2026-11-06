import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import { ApplicationError } from "../models/application-error";
import { stopSuppressedSequences } from "./email-sequence-observations";
import type { Clock } from "../models/business";
import type { WorkIdentity } from "../models/discovery";
import type {
  AddEmailSuppression,
  IncomingOptOutEvidence,
  EmailActionRef,
  EmailContentReview,
  EmailEligibilityWorkspace,
  publishEmailPolicySchema,
  saveRecipientFactsSchema,
} from "../models/email-eligibility";
import { hasMfa, operatorMfaLifetime } from "../auth/access";
import type { Database } from "./runtime";
import { requireCapability, scoped, type Transaction } from "./scope";
import { requireSalesSession } from "./sales-session";
import {
  emailActionContext,
  evaluateEmailAction,
  lockEmailPolicies,
  marketPolicyKey,
} from "./email-eligibility-context";
import {
  commercialProposal,
  campaignRevision,
  discoveryProspect,
  emailActionReview,
  emailEligibilityEvaluation,
  emailMarketPolicy,
  emailRecipientRevision,
  emailSuppression,
  inboxConnection,
  inboxOpportunity,
  opportunityDueAction,
  platformOperator,
  session,
} from "./schema";

async function opportunity(tx: Transaction, businessId: string, id: string) {
  const [row] = await tx
    .select()
    .from(inboxOpportunity)
    .where(
      and(
        eq(inboxOpportunity.businessId, businessId),
        eq(inboxOpportunity.id, id),
      ),
    );
  if (!row) throw new ApplicationError("NOT_FOUND");
  return row;
}
export async function persistEmailSuppression(
  tx: Transaction,
  businessId: string,
  actorId: string,
  input: AddEmailSuppression,
  at: Date,
  source: "business" | "incoming_opt_out" = "business",
  evidence: IncomingOptOutEvidence | null = null,
) {
  const [seen] = await tx
    .select()
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.businessId, businessId),
        eq(emailSuppression.requestKey, input.requestKey),
      ),
    );
  if (seen) {
    if (!isDeepStrictEqual(seen.suppression, input) || seen.source !== source)
      throw new ApplicationError("CONFLICT");
    return seen.id;
  }
  if (input.opportunityId)
    await opportunity(tx, businessId, input.opportunityId);
  const id = randomUUID();
  await tx.insert(emailSuppression).values({
    id,
    businessId,
    recipient: input.recipient,
    requestKey: input.requestKey,
    suppression: input,
    source,
    evidence,
    actorId,
    at,
  });
  if (new Date(input.effectiveAt) <= at)
    await stopSuppressedSequences(
      tx,
      businessId,
      input.recipient,
      input.scope === "opportunity_outreach" ? input.opportunityId : null,
      actorId,
      at,
    );
  // Ownership and control generations are deliberately untouched. The dispatch gate covers committed work too.
  return id;
}
export function createEmailEligibilityRepository(
  database: Database,
  clock: Clock,
) {
  function scope<T>(
    actor: WorkIdentity,
    businessId: string,
    operation: (tx: Transaction, canManage: boolean) => Promise<T>,
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
        return operation(tx, role !== "salesperson");
      },
      { lock: true },
    );
  }
  async function operator(tx: Transaction, actor: WorkIdentity) {
    const [grant] = await tx
      .select()
      .from(platformOperator)
      .where(eq(platformOperator.userId, actor.userId));
    if (!grant?.emailPolicy) throw new ApplicationError("FORBIDDEN");
    const [s] = await tx
      .select()
      .from(session)
      .where(
        and(eq(session.id, actor.sessionId), eq(session.userId, actor.userId)),
      );
    if (!s || !(await hasMfa(tx, s.token, clock.now(), operatorMfaLifetime)))
      throw new ApplicationError("MFA_REQUIRED");
  }
  return {
    workspace(
      actor: WorkIdentity,
      businessId: string,
    ): Promise<EmailEligibilityWorkspace> {
      return scope(actor, businessId, async (tx, canManage) => {
        const policies = await tx
          .select()
          .from(emailMarketPolicy)
          .orderBy(asc(emailMarketPolicy.key), desc(emailMarketPolicy.version));
        const recipients = await tx
          .select()
          .from(emailRecipientRevision)
          .where(eq(emailRecipientRevision.businessId, businessId))
          .orderBy(desc(emailRecipientRevision.version));
        const suppressions = await tx
          .select()
          .from(emailSuppression)
          .where(eq(emailSuppression.businessId, businessId))
          .orderBy(desc(emailSuppression.at));
        const evaluations = await tx
          .select()
          .from(emailEligibilityEvaluation)
          .where(eq(emailEligibilityEvaluation.businessId, businessId))
          .orderBy(desc(emailEligibilityEvaluation.sequence))
          .limit(200);
        const [grant] = await tx
          .select()
          .from(platformOperator)
          .where(eq(platformOperator.userId, actor.userId));
        const due = await tx
          .select({ id: opportunityDueAction.id })
          .from(opportunityDueAction)
          .innerJoin(
            inboxConnection,
            eq(inboxConnection.id, opportunityDueAction.connectionId),
          )
          .where(
            and(
              eq(opportunityDueAction.businessId, businessId),
              eq(inboxConnection.channel, "email"),
            ),
          )
          .orderBy(desc(opportunityDueAction.createdAt))
          .limit(100);
        const proposals = await tx
          .select()
          .from(commercialProposal)
          .where(eq(commercialProposal.businessId, businessId))
          .orderBy(desc(commercialProposal.at))
          .limit(100);
        const refs: EmailActionRef[] = [
          ...due.map((r) => ({ kind: "opportunity" as const, id: r.id })),
          ...proposals
            .filter((r) => r.payload.channel === "email")
            .map((r) => ({ kind: "commercial" as const, id: r.id })),
        ];
        const campaigns = await tx
          .select()
          .from(campaignRevision)
          .where(eq(campaignRevision.businessId, businessId))
          .orderBy(desc(campaignRevision.at));
        for (const r of campaigns)
          for (const recipient of r.snapshot.recipients)
            for (let i = 0; i < r.snapshot.steps.length; i++)
              refs.push({
                kind: "campaign",
                id: r.id,
                recipientKey: recipient.contactId,
                stepIndex: i,
              });
        const actions = [];
        for (const ref of refs) {
          const c = await emailActionContext(tx, businessId, ref);
          actions.push({
            action: ref,
            opportunityId: c.opportunityId,
            recipient: c.recipient,
            purpose: c.purpose,
            description:
              c.content ??
              "No prepared email body. Content review cannot pass until an email is prepared.",
          });
        }
        return {
          canManage,
          canPublish: Boolean(grant?.emailPolicy),
          policies: policies.map((r) => ({ ...r, at: r.at.toISOString() })),
          recipients: recipients.map((r) => ({ ...r, at: r.at.toISOString() })),
          suppressions: suppressions.map((r) => ({
            ...r.suppression,
            id: r.id,
            source: r.source,
            actorId: r.actorId,
            at: r.at.toISOString(),
          })),
          evaluations: evaluations.map((r) => r.result),
          actions,
        };
      });
    },
    saveRecipient(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof saveRecipientFactsSchema>,
    ) {
      return scope(actor, businessId, async (tx, canManage) => {
        if (!canManage) throw new ApplicationError("FORBIDDEN");
        await lockEmailPolicies(tx);
        for (const e of input.facts.permissions) {
          if (e.opportunityId)
            await opportunity(tx, businessId, e.opportunityId);
          else {
            const [prospect] = await tx
              .select()
              .from(discoveryProspect)
              .where(
                and(
                  eq(discoveryProspect.businessId, businessId),
                  eq(discoveryProspect.id, e.prospectId!),
                ),
              );
            if (!prospect) throw new ApplicationError("NOT_FOUND");
          }
          const [policy] = await tx
            .select()
            .from(emailMarketPolicy)
            .where(eq(emailMarketPolicy.id, e.policyId));
          if (
            !policy ||
            policy.policy.market !== input.facts.market ||
            policy.policy.recipientClass !== input.facts.recipientClass ||
            policy.policy.purpose !== e.purpose ||
            !policy.policy.acceptedEvidence.includes(e.kind)
          )
            throw new ApplicationError("INVALID_INPUT");
        }
        const [last] = await tx
          .select()
          .from(emailRecipientRevision)
          .where(
            and(
              eq(emailRecipientRevision.businessId, businessId),
              eq(emailRecipientRevision.recipient, input.facts.recipient),
            ),
          )
          .orderBy(desc(emailRecipientRevision.version))
          .limit(1);
        if ((last?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const row = {
          id: randomUUID(),
          businessId,
          recipient: input.facts.recipient,
          version: input.expectedVersion + 1,
          facts: input.facts,
          actorId: actor.userId,
          at: clock.now(),
        };
        await tx.insert(emailRecipientRevision).values(row);
        return { ...row, at: row.at.toISOString() };
      });
    },
    suppress(
      actor: WorkIdentity,
      businessId: string,
      input: AddEmailSuppression,
    ) {
      return scope(actor, businessId, (tx) =>
        persistEmailSuppression(
          tx,
          businessId,
          actor.userId,
          input,
          clock.now(),
        ),
      );
    },
    publishPolicy(
      actor: WorkIdentity,
      businessId: string,
      input: z.infer<typeof publishEmailPolicySchema>,
    ) {
      return scope(actor, businessId, async (tx) => {
        await lockEmailPolicies(tx, true);
        await operator(tx, actor);
        const key = marketPolicyKey(input.policy);
        const [last] = await tx
          .select()
          .from(emailMarketPolicy)
          .where(eq(emailMarketPolicy.key, key))
          .orderBy(desc(emailMarketPolicy.version))
          .limit(1);
        if ((last?.version ?? 0) !== input.expectedVersion)
          throw new ApplicationError("CONFLICT");
        const row = {
          id: randomUUID(),
          key,
          version: input.expectedVersion + 1,
          policy: input.policy,
          actorId: actor.userId,
          at: clock.now(),
        };
        await tx.insert(emailMarketPolicy).values(row);
        return { ...row, at: row.at.toISOString() };
      });
    },
    reviewContent(
      actor: WorkIdentity,
      businessId: string,
      input: EmailContentReview,
    ) {
      return scope(actor, businessId, async (tx, canManage) => {
        if (!canManage) throw new ApplicationError("FORBIDDEN");
        const c = await emailActionContext(tx, businessId, input.action);
        if (!c.content || !c.bindingValid)
          throw new ApplicationError("CONFLICT");
        await tx.insert(emailActionReview).values({
          id: randomUUID(),
          businessId,
          actionId: input.action.id,
          fingerprint: c.fingerprint,
          review: input,
          actorId: actor.userId,
          at: clock.now(),
        });
      });
    },
    evaluate(actor: WorkIdentity, businessId: string, ref: EmailActionRef) {
      return scope(actor, businessId, (tx) =>
        evaluateEmailAction(tx, businessId, ref, actor.userId, clock.now()),
      );
    },
  };
}
