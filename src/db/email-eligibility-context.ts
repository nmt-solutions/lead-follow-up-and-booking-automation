import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { ApplicationError } from "../models/application-error";
import {
  emailRecipientSchema,
  type EmailActionRef,
  type EmailEligibility,
  type EmailPurpose,
  type EligibilityCheck,
} from "../models/email-eligibility";
import type { Transaction } from "./scope";
import {
  commercialProposal,
  emailActionReview,
  emailEligibilityEvaluation,
  emailMarketPolicy,
  emailRecipientRevision,
  emailSuppression,
  inboxConnection,
  inboxMessage,
  inboxMessageLink,
  inquiryRun,
  opportunityDueAction,
  senderObservation,
} from "./schema";
import { responseSender } from "./sender-repository";

export const emailPolicyLock = "email-market-policies";
export async function lockEmailPolicies(tx: Transaction, write = false) {
  if (write)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${emailPolicyLock},0))`,
    );
  else
    await tx.execute(
      sql`select pg_advisory_xact_lock_shared(hashtextextended(${emailPolicyLock},0))`,
    );
}
export function marketPolicyKey(p: {
  market: string;
  recipientClass: string;
  purpose: string;
}) {
  return `${p.market}:${p.recipientClass}:${p.purpose}`;
}

/** The action and exact received-message identity are authoritative, never client-supplied purpose/recipient flags. */
export async function emailActionContext(
  tx: Transaction,
  businessId: string,
  ref: EmailActionRef,
) {
  const [due] =
    ref.kind === "opportunity"
      ? await tx
          .select()
          .from(opportunityDueAction)
          .where(
            and(
              eq(opportunityDueAction.businessId, businessId),
              eq(opportunityDueAction.id, ref.id),
            ),
          )
      : [];
  const [proposal] =
    ref.kind === "commercial"
      ? await tx
          .select()
          .from(commercialProposal)
          .where(
            and(
              eq(commercialProposal.businessId, businessId),
              eq(commercialProposal.id, ref.id),
            ),
          )
      : [];
  const action = due ?? proposal;
  if (!action) throw new ApplicationError("NOT_FOUND");
  const messageId = due?.messageId ?? proposal?.payload.messageId;
  const [source] = await tx
    .select({
      message: inboxMessage,
      link: inboxMessageLink,
      connection: inboxConnection,
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
        eq(inboxMessage.id, messageId ?? ""),
      ),
    );
  if (!source || source.connection.channel !== "email")
    throw new ApplicationError("NOT_FOUND");
  const parsed = emailRecipientSchema.safeParse(
    source.message.content.senderRef,
  );
  const recipient = parsed.success
    ? parsed.data
    : source.message.content.senderRef;
  const [run] = due?.inquiryRunId
    ? await tx
        .select()
        .from(inquiryRun)
        .where(
          and(
            eq(inquiryRun.businessId, businessId),
            eq(inquiryRun.id, due.inquiryRunId),
          ),
        )
    : [];
  const purpose: EmailPurpose = run ? "inquiry_response" : "sales_follow_up";
  const content =
    run?.result.body ??
    (proposal
      ? `${proposal.payload.description}\n${proposal.payload.terms}`
      : null);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        ref,
        businessId,
        opportunityId: action.opportunityId,
        messageId,
        recipient,
        purpose,
        content,
        payload: proposal?.payload ?? due?.evaluation,
      }),
    )
    .digest("hex");
  return {
    ref,
    opportunityId: action.opportunityId,
    recipient,
    purpose,
    content,
    fingerprint,
    source,
    bindingValid:
      source.link.opportunityId === action.opportunityId &&
      (!proposal ||
        (proposal.payload.recipientRef.toLowerCase() === recipient &&
          proposal.payload.connectionId === source.connection.id)) &&
      (!run ||
        (run.opportunityId === action.opportunityId &&
          run.messageId === messageId &&
          run.result.status === "ready")),
  };
}

export async function currentRecipient(
  tx: Transaction,
  businessId: string,
  recipient: string,
  at: Date,
) {
  const [row] = await tx
    .select()
    .from(emailRecipientRevision)
    .where(
      and(
        eq(emailRecipientRevision.businessId, businessId),
        eq(emailRecipientRevision.recipient, recipient),
        sql`(${emailRecipientRevision.facts}->>'effectiveAt')::timestamptz <= ${at.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(emailRecipientRevision.version))
    .limit(1);
  return row ?? null;
}
export async function currentEmailPolicy(
  tx: Transaction,
  key: string,
  at: Date,
) {
  const [row] = await tx
    .select()
    .from(emailMarketPolicy)
    .where(
      and(
        eq(emailMarketPolicy.key, key),
        sql`(${emailMarketPolicy.policy}->>'effectiveAt')::timestamptz <= ${at.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(desc(emailMarketPolicy.version))
    .limit(1);
  return row ?? null;
}

/** Caller holds the Business lock; policy read lock remains held through the external-effect boundary. */
export async function evaluateEmailAction(
  tx: Transaction,
  businessId: string,
  ref: EmailActionRef,
  actorId: string,
  at: Date,
): Promise<EmailEligibility> {
  await lockEmailPolicies(tx);
  const c = await emailActionContext(tx, businessId, ref);
  const facts = await currentRecipient(tx, businessId, c.recipient, at);
  const policy =
    facts?.facts.market && facts.facts.recipientClass !== "unknown"
      ? await currentEmailPolicy(
          tx,
          marketPolicyKey({
            ...facts.facts,
            market: facts.facts.market,
            purpose: c.purpose,
          }),
          at,
        )
      : null;
  const suppressions = await tx
    .select()
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.businessId, businessId),
        eq(emailSuppression.recipient, c.recipient),
      ),
    );
  const covered = suppressions.filter(
    ({ suppression: s }) =>
      new Date(s.effectiveAt) <= at &&
      (s.scope === "recipient_email" ||
        (c.purpose !== "inquiry_response" &&
          (s.scope === "recipient_outreach" ||
            s.opportunityId === c.opportunityId))),
  );
  const sender = await responseSender(
    tx,
    businessId,
    c.source.connection.id,
    at,
    c.purpose === "inquiry_response" ? "inbound" : "existing_conversation",
  );
  const checks: EligibilityCheck[] = [];
  const check = (
    code: string,
    status: EligibilityCheck["status"],
    detail: string,
    nextAction: string,
  ) => checks.push({ code, status, detail, nextAction });
  check(
    "recipient_binding",
    c.bindingValid && emailRecipientSchema.safeParse(c.recipient).success
      ? "allowed"
      : "blocked",
    "The recipient and purpose are bound to the persisted action and Opportunity.",
    "Review the action's exact email recipient and current message association.",
  );
  check(
    "destination",
    facts?.facts.market && new Date(facts.facts.validUntil) > at
      ? "allowed"
      : "unknown",
    "Destination requires current attributed evidence; Business home market and discovery reach do not establish it.",
    "Record or refresh the recipient's destination evidence.",
  );
  check(
    "recipient_class",
    facts &&
      facts.facts.recipientClass !== "unknown" &&
      new Date(facts.facts.validUntil) > at
      ? "allowed"
      : "unknown",
    "Legal recipient class is separate from buyer category or mailbox domain.",
    "Record the evidenced legal recipient class; retain unknown when ambiguous.",
  );
  check(
    "market_policy",
    !policy || new Date(policy.policy.validUntil) <= at
      ? "unknown"
      : policy.policy.enabled
        ? "allowed"
        : "blocked",
    "An attributable current policy must cover this exact destination, recipient class and purpose.",
    "Ask an authorized platform policy operator to configure or review this market/purpose policy.",
  );
  const evidence: EmailEligibility["evidence"] = [];
  if (facts && new Date(facts.facts.validUntil) > at)
    for (const e of facts.facts.permissions) {
      if (
        e.policyId === policy?.id &&
        e.purpose === c.purpose &&
        e.opportunityId === c.opportunityId &&
        new Date(e.observedAt) <= at &&
        new Date(e.validUntil) > at &&
        policy?.policy.acceptedEvidence.includes(e.kind)
      )
        evidence.push({
          kind: e.kind,
          reference: e.reference,
          actorId: facts.actorId,
          observedAt: e.observedAt,
        });
    }
  if (
    c.purpose === "inquiry_response" &&
    c.source.message.content.kind === "direct_inquiry" &&
    policy?.policy.acceptedEvidence.includes("direct_inquiry")
  )
    evidence.push({
      kind: "direct_inquiry",
      reference: `message:${c.source.message.id}`,
      actorId: null,
      observedAt: c.source.message.content.occurredAt,
    });
  check(
    "permission",
    evidence.length ? "allowed" : "unknown",
    "Only purpose- and Opportunity-specific evidence accepted by the selected policy can qualify. Public details, DNS/MX, paid reach and AI text confer no permission.",
    "Record current consent or the policy's documented relationship evidence for this purpose and Opportunity.",
  );
  check(
    "sender",
    sender.sender && !sender.reason ? "allowed" : "blocked",
    sender.reason ?? "The current sending identity and reply path are ready.",
    "Review Sending identities and reply visibility; eligibility cannot repair sender setup.",
  );
  check(
    "suppression",
    covered.length ? "blocked" : "allowed",
    covered.length
      ? "An effective opt-out covers this recipient, purpose and scope."
      : "No effective suppression covers this action.",
    covered.length
      ? "Honor the opt-out; review the covered scope and history. Do not retry covered outreach."
      : "Recheck at dispatch; later opt-outs can still stop this action.",
  );
  const reviews = await tx
    .select()
    .from(emailActionReview)
    .where(
      and(
        eq(emailActionReview.businessId, businessId),
        eq(emailActionReview.actionId, ref.id),
        eq(emailActionReview.fingerprint, c.fingerprint),
        lte(emailActionReview.at, at),
      ),
    );
  for (const required of policy?.policy.requiredContent ?? [])
    check(
      `content_${required}`,
      required !== "one_click_unsubscribe" &&
        c.content &&
        reviews.some(
          (r) =>
            r.review.action.kind === ref.kind &&
            r.review.requirements.includes(required),
        )
        ? "allowed"
        : "unknown",
      required === "one_click_unsubscribe"
        ? "No scoped one-click unsubscribe transport is configured. A content-review checkbox cannot establish that capability."
        : `The exact prepared email requires an attributed review of ${required.replaceAll("_", " ")}.`,
      required === "one_click_unsubscribe"
        ? "Keep this action blocked until a supported scoped unsubscribe transport is integrated and verified."
        : "An Owner or Admin must review the prepared content against the configured policy; changed content requires a new review.",
    );
  const futureFacts = await tx
    .select()
    .from(emailRecipientRevision)
    .where(
      and(
        eq(emailRecipientRevision.businessId, businessId),
        eq(emailRecipientRevision.recipient, c.recipient),
      ),
    );
  const futurePolicies = policy
    ? await tx
        .select()
        .from(emailMarketPolicy)
        .where(eq(emailMarketPolicy.key, policy.key))
    : [];
  const [senderProof] = sender.sender
    ? await tx
        .select()
        .from(senderObservation)
        .where(
          and(
            eq(senderObservation.businessId, businessId),
            eq(senderObservation.id, sender.sender.evidenceId),
          ),
        )
    : [];
  const boundaries = [
    facts?.facts.validUntil,
    policy?.policy.validUntil,
    senderProof?.evidence.validUntil,
    ...(facts?.facts.permissions
      .filter(
        (e) =>
          e.opportunityId === c.opportunityId &&
          e.purpose === c.purpose &&
          e.policyId === policy?.id,
      )
      .map((e) => e.validUntil) ?? []),
    ...futureFacts
      .filter((r) => r.version > (facts?.version ?? 0))
      .map((r) => r.facts.effectiveAt),
    ...futurePolicies
      .filter((r) => r.version > (policy?.version ?? 0))
      .map((r) => r.policy.effectiveAt),
    ...suppressions
      .filter(
        ({ suppression: s }) =>
          s.scope === "recipient_email" ||
          (c.purpose !== "inquiry_response" &&
            (s.scope === "recipient_outreach" ||
              s.opportunityId === c.opportunityId)),
      )
      .map((r) => r.suppression.effectiveAt),
  ]
    .filter((value): value is string => Boolean(value) && new Date(value!) > at)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const result: EmailEligibility = {
    id: randomUUID(),
    action: ref,
    opportunityId: c.opportunityId,
    recipient: c.recipient,
    purpose: c.purpose,
    fingerprint: c.fingerprint,
    policyId: policy?.id ?? null,
    recipientRevisionId: facts?.id ?? null,
    evidence,
    suppressionIds: covered.map((r) => r.id),
    senderIdentityId: sender.sender?.identityId ?? null,
    checks,
    status: checks.some((v) => v.status === "blocked")
      ? "blocked"
      : checks.some((v) => v.status === "unknown")
        ? "unknown"
        : "allowed",
    at: at.toISOString(),
    recheckAt: boundaries[0] ?? null,
  };
  await persistEmailDecision(tx, businessId, actorId, result);
  return result;
}

/** A time boundary can pass during persistence even though concurrent writes are locked out. */
export async function emailDecisionAtDispatch(
  tx: Transaction,
  businessId: string,
  actorId: string,
  result: EmailEligibility,
  at: Date,
): Promise<EmailEligibility> {
  if (
    result.status !== "allowed" ||
    !result.recheckAt ||
    at < new Date(result.recheckAt)
  )
    return result;
  const expired: EmailEligibility = {
    ...result,
    id: randomUUID(),
    at: at.toISOString(),
    status: "unknown",
    checks: [
      ...result.checks,
      {
        code: "effective_time_changed",
        status: "unknown",
        detail:
          "A configured evidence, policy, sender or suppression time boundary passed before the provider started.",
        nextAction:
          "Evaluate the current state and prepare a new action after review.",
      },
    ],
  };
  await persistEmailDecision(tx, businessId, actorId, expired);
  return expired;
}
async function persistEmailDecision(
  tx: Transaction,
  businessId: string,
  actorId: string,
  result: EmailEligibility,
) {
  const [last] = await tx
    .select({ sequence: emailEligibilityEvaluation.sequence })
    .from(emailEligibilityEvaluation)
    .where(eq(emailEligibilityEvaluation.businessId, businessId))
    .orderBy(desc(emailEligibilityEvaluation.sequence))
    .limit(1);
  await tx.insert(emailEligibilityEvaluation).values({
    id: result.id,
    businessId,
    actionId: result.action.id,
    result,
    actorId,
    at: new Date(result.at),
    sequence: (last?.sequence ?? 0) + 1,
  });
}
