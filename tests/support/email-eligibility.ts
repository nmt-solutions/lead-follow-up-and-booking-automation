import { createEmailEligibilityApplication } from "../../src/application/email-eligibility";
import { createEmailEligibilityRepository } from "../../src/db/email-eligibility-repository";
import { runtimeDatabase } from "../../src/db/runtime";
import type { createHarness } from "./harness";
import type { EmailPurpose } from "../../src/models/email-eligibility";

export function eligibilityApplication(
  h: Awaited<ReturnType<typeof createHarness>>,
) {
  return createEmailEligibilityApplication({
    authenticate: h.access.authenticateForWork,
    repository: createEmailEligibilityRepository(
      runtimeDatabase(h.runtime),
      h.clock,
    ),
    clock: h.clock,
  });
}
/** Explicit synthetic policy/evidence fixtures, never installed by production composition. */
export async function configureEmailFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  credentials: Headers,
  businessId: string,
  opportunityId: string,
  recipient = "buyer@example.net",
  purposes: EmailPurpose[] = ["sales_follow_up", "inquiry_response"],
) {
  const actor = await h.authenticate(credentials);
  await h.admin.query(
    "insert into platform_operator (user_id,email_policy) values ($1,true) on conflict (user_id) do update set email_policy=true",
    [actor.userId],
  );
  const app = eligibilityApplication(h);
  const state = await app.workspace(credentials, businessId);
  for (const purpose of purposes) {
    const last = state.policies.find(
      (r) =>
        r.policy.market === "US" &&
        r.policy.recipientClass === "corporate" &&
        r.policy.purpose === purpose,
    );
    if (!last)
      await app.publishPolicy(credentials, businessId, {
        expectedVersion: 0,
        policy: {
          market: "US",
          recipientClass: "corporate",
          purpose,
          enabled: true,
          effectiveAt: h.clock.now().toISOString(),
          validUntil: "2027-01-01T00:00:00Z",
          acceptedEvidence:
            purpose === "inquiry_response"
              ? ["direct_inquiry", "consent"]
              : ["consent"],
          requiredContent: [],
          incomingOptOutScope: "recipient_outreach",
          sources: [
            "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business",
          ],
          rationale:
            "Synthetic deterministic policy; not production legal approval",
        },
      });
  }
  const current = state.recipients.find((r) => r.facts.recipient === recipient);
  const policies = (await app.workspace(credentials, businessId)).policies;
  const facts = {
    recipient,
    market: "US",
    recipientClass: "corporate",
    reference: "Explicit synthetic destination and legal class fixture",
    effectiveAt: h.clock.now().toISOString(),
    validUntil: "2027-01-01T00:00:00Z",
    permissions: [
      ...(current?.facts.permissions ?? []),
      ...purposes.map((purpose) => ({
        kind: "consent",
        purpose,
        policyId: policies.find(
          (p) =>
            p.policy.market === "US" &&
            p.policy.recipientClass === "corporate" &&
            p.policy.purpose === purpose,
        )!.id,
        opportunityId,
        reference: "Synthetic permission for only this Opportunity and purpose",
        observedAt: h.clock.now().toISOString(),
        validUntil: "2027-01-01T00:00:00Z",
      })),
    ],
  };
  await app.saveRecipient(credentials, businessId, {
    expectedVersion: current?.version ?? 0,
    facts,
  });
  return app;
}
