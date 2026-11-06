import { z } from "zod";

const note = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v));
export const emailRecipientSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const emailPurposes = [
  "inquiry_response",
  "sales_outreach",
  "sales_follow_up",
] as const;
export const emailPurposeSchema = z.enum(emailPurposes);
export type EmailPurpose = z.infer<typeof emailPurposeSchema>;
export const recipientClasses = [
  "corporate",
  "individual",
  "sole_trader",
  "partnership",
  "unknown",
] as const;
export const evidenceKinds = [
  "consent",
  "documented_relationship",
  "direct_inquiry",
] as const;
export const suppressionScopes = [
  "recipient_outreach",
  "opportunity_outreach",
  "recipient_email",
] as const;
export const contentRequirements = [
  "postal_address",
  "advertising_disclosure",
  "unsubscribe_instructions",
  "one_click_unsubscribe",
  "purpose_review",
] as const;
const instant = z.iso.datetime({ offset: true });
const market = z.string().regex(/^[A-Z]{2}$/);
const sourceUrl = z.url().refine((v) => {
  const u = new URL(v);
  return u.protocol === "https:" && !u.username && !u.password;
});
export const emailMarketPolicySchema = z
  .strictObject({
    market,
    recipientClass: z.enum(recipientClasses).exclude(["unknown"]),
    purpose: emailPurposeSchema,
    enabled: z.boolean(),
    effectiveAt: instant,
    validUntil: instant,
    acceptedEvidence: z.array(z.enum(evidenceKinds)).min(1).max(3),
    requiredContent: z.array(z.enum(contentRequirements)).max(5),
    incomingOptOutScope: z.enum(suppressionScopes),
    sources: z.array(sourceUrl).min(1).max(10),
    rationale: note,
  })
  .superRefine((v, c) => {
    if (new Date(v.validUntil) <= new Date(v.effectiveAt))
      c.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Policy expiry must follow its effective time",
      });
    if (
      v.purpose !== "inquiry_response" &&
      v.acceptedEvidence.includes("direct_inquiry")
    )
      c.addIssue({
        code: "custom",
        path: ["acceptedEvidence"],
        message: "An inquiry does not authorize unrelated outreach",
      });
  });
export type EmailMarketPolicy = z.infer<typeof emailMarketPolicySchema>;
export const publishEmailPolicySchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  policy: emailMarketPolicySchema,
});
export const recipientPermissionSchema = z
  .strictObject({
    kind: z.enum(["consent", "documented_relationship"]),
    purpose: emailPurposeSchema,
    policyId: z.uuid(),
    opportunityId: z.uuid(),
    reference: note,
    observedAt: instant,
    validUntil: instant,
  })
  .refine((v) => new Date(v.validUntil) > new Date(v.observedAt), {
    path: ["validUntil"],
    message: "Permission expiry must follow its observed time",
  });
export const recipientFactsSchema = z
  .strictObject({
    recipient: emailRecipientSchema,
    market: market.nullable(),
    recipientClass: z.enum(recipientClasses),
    reference: note,
    effectiveAt: instant,
    validUntil: instant,
    permissions: z.array(recipientPermissionSchema).max(100),
  })
  .refine((v) => new Date(v.validUntil) > new Date(v.effectiveAt), {
    path: ["validUntil"],
    message: "Evidence expiry must follow its effective time",
  });
export type RecipientFacts = z.infer<typeof recipientFactsSchema>;
export const saveRecipientFactsSchema = z.strictObject({
  expectedVersion: z.number().int().min(0),
  facts: recipientFactsSchema,
});
export const addEmailSuppressionSchema = z
  .strictObject({
    requestKey: z.uuid(),
    recipient: emailRecipientSchema,
    scope: z.enum(suppressionScopes),
    opportunityId: z.uuid().nullable(),
    effectiveAt: instant,
    reference: note,
  })
  .refine(
    (v) =>
      v.scope === "opportunity_outreach"
        ? v.opportunityId !== null
        : v.opportunityId === null,
    {
      path: ["opportunityId"],
      message:
        "Choose an Opportunity only for one-Opportunity outreach scope; leave it blank for Business-recipient scopes",
    },
  );
export type AddEmailSuppression = z.infer<typeof addEmailSuppressionSchema>;
export type IncomingOptOutEvidence = {
  connectionId: string;
  messageRef: string;
  eventRef: string;
  fingerprint: string;
  conversationId: string;
  sourceMessageId: string;
  policyId: string | null;
};
export const emailActionRefSchema = z.strictObject({
  kind: z.enum(["opportunity", "commercial"]),
  id: z.uuid(),
});
export type EmailActionRef = z.infer<typeof emailActionRefSchema>;
export const emailContentReviewSchema = z.strictObject({
  action: emailActionRefSchema,
  requirements: z.array(z.enum(contentRequirements)).min(1).max(5),
  reference: note,
});
export type EmailContentReview = z.infer<typeof emailContentReviewSchema>;
export type EmailPolicyRevision = {
  id: string;
  key: string;
  version: number;
  policy: EmailMarketPolicy;
  actorId: string;
  at: string;
};
export type RecipientRevision = {
  id: string;
  version: number;
  facts: RecipientFacts;
  actorId: string;
  at: string;
};
export type EmailSuppression = AddEmailSuppression & {
  id: string;
  actorId: string;
  at: string;
  source: "business" | "incoming_opt_out";
};
export type EligibilityCheck = {
  code: string;
  status: "allowed" | "blocked" | "unknown";
  detail: string;
  nextAction: string;
};
export type EmailEligibility = {
  id: string;
  action: EmailActionRef;
  opportunityId: string;
  recipient: string;
  purpose: EmailPurpose;
  fingerprint: string;
  policyId: string | null;
  recipientRevisionId: string | null;
  evidence: {
    kind: string;
    reference: string;
    actorId: string | null;
    observedAt: string;
  }[];
  suppressionIds: string[];
  senderIdentityId: string | null;
  checks: EligibilityCheck[];
  status: "allowed" | "blocked" | "unknown";
  at: string;
  recheckAt: string | null;
};
export type EmailEligibilityWorkspace = {
  canManage: boolean;
  canPublish: boolean;
  policies: EmailPolicyRevision[];
  recipients: RecipientRevision[];
  suppressions: EmailSuppression[];
  evaluations: EmailEligibility[];
  actions: {
    action: EmailActionRef;
    opportunityId: string;
    recipient: string;
    purpose: EmailPurpose;
    description: string;
  }[];
};
export type EmailDispatchAuthorization = Pick<
  EmailEligibility,
  | "id"
  | "recipient"
  | "purpose"
  | "fingerprint"
  | "policyId"
  | "recipientRevisionId"
>;
export function emailDispatchAuthorization(
  result: EmailEligibility,
): EmailDispatchAuthorization {
  return {
    id: result.id,
    recipient: result.recipient,
    purpose: result.purpose,
    fingerprint: result.fingerprint,
    policyId: result.policyId,
    recipientRevisionId: result.recipientRevisionId,
  };
}
const actionRef = emailActionRefSchema;
export const emailEligibilityWorkspaceSchema: z.ZodType<EmailEligibilityWorkspace> =
  z.object({
    canManage: z.boolean(),
    canPublish: z.boolean(),
    policies: z.array(
      z.object({
        id: z.uuid(),
        key: z.string(),
        version: z.number().int(),
        policy: emailMarketPolicySchema,
        actorId: z.string(),
        at: instant,
      }),
    ),
    recipients: z.array(
      z.object({
        id: z.uuid(),
        version: z.number().int(),
        facts: recipientFactsSchema,
        actorId: z.string(),
        at: instant,
      }),
    ),
    suppressions: z.array(
      z.object({
        requestKey: z.uuid(),
        recipient: emailRecipientSchema,
        scope: z.enum(suppressionScopes),
        opportunityId: z.uuid().nullable(),
        effectiveAt: instant,
        reference: note,
        id: z.uuid(),
        actorId: z.string(),
        at: instant,
        source: z.enum(["business", "incoming_opt_out"]),
      }),
    ),
    evaluations: z.array(
      z.object({
        id: z.uuid(),
        action: actionRef,
        opportunityId: z.uuid(),
        recipient: z.string(),
        purpose: emailPurposeSchema,
        fingerprint: z.string(),
        policyId: z.uuid().nullable(),
        recipientRevisionId: z.uuid().nullable(),
        evidence: z.array(
          z.object({
            kind: z.string(),
            reference: z.string(),
            actorId: z.string().nullable(),
            observedAt: instant,
          }),
        ),
        suppressionIds: z.array(z.uuid()),
        senderIdentityId: z.uuid().nullable(),
        checks: z.array(
          z.object({
            code: z.string(),
            status: z.enum(["allowed", "blocked", "unknown"]),
            detail: z.string(),
            nextAction: z.string(),
          }),
        ),
        status: z.enum(["allowed", "blocked", "unknown"]),
        at: instant,
        recheckAt: instant.nullable(),
      }),
    ),
    actions: z.array(
      z.object({
        action: actionRef,
        opportunityId: z.uuid(),
        recipient: z.string(),
        purpose: emailPurposeSchema,
        description: z.string(),
      }),
    ),
  });
