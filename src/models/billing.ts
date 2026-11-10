import { z } from "zod";
import { indiaStateCode, validGstin } from "./india-gst";

const field = z.string().trim().max(300);
// ISO 3166-1 alpha-2 country identifiers; no tax coverage or treatment is implied.
const countryCodes = new Set(
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  ),
);
const country = z
  .string()
  .refine(
    (value) => value === "" || countryCodes.has(value),
    "Use a two-letter country code or leave unknown.",
  );
export const billingDeclarationSchema = z.strictObject({
  version: z.literal("2026-11-10"),
  actorId: z.string().min(1),
  at: z.iso.datetime(),
  acceptedTerms: z.literal(true),
});
export const declarationReviewNote =
  "Customer-declared billing details; no independent identity or tax verification.";
const billingProfileObjectSchema = z.strictObject({
  declaration: billingDeclarationSchema.optional(),
  indiaTaxTreatment: z.enum(["standard", "needs_review"]).optional(),
  legalName: field,
  registrationNumber: field,
  address: z.strictObject({
    line1: field,
    line2: field,
    city: field,
    region: field,
    postalCode: field,
    country,
  }),
  invoiceContact: z.strictObject({
    name: field,
    email: z.union([z.literal(""), z.email().max(254)]),
  }),
  businessStatus: z.enum(["unknown", "business", "individual"]),
  taxIdentifierStatus: z.enum(["unknown", "provided", "not_applicable"]),
  taxIdentifiers: z
    .array(
      z.strictObject({
        kind: field.min(1),
        country: country.refine(Boolean),
        value: field.min(1),
      }),
    )
    .max(20),
  evidence: z
    .array(
      z.strictObject({
        kind: z.enum([
          "legal_identity",
          "billing_address",
          "business_status",
          "tax_identifier",
        ]),
        fileId: z.uuid(),
        note: z.string().trim().min(1).max(1000),
      }),
    )
    .max(40),
});
export const billingProfileSchema = billingProfileObjectSchema.superRefine(
  (value, ctx) => {
    if (
      new Set(value.evidence.map((e) => `${e.kind}:${e.fileId}`)).size !==
      value.evidence.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Use distinct evidence attachments.",
      });
  },
);
export const billingSaveSchema = z.strictObject({
  expectedVersion: z.number().int().min(0).max(2147483646),
  note: z.string().trim().min(1).max(1000),
  profile: billingProfileObjectSchema
    .omit({ declaration: true })
    .refine(
      (value) =>
        new Set(value.evidence.map((entry) => `${entry.kind}:${entry.fileId}`))
          .size === value.evidence.length,
      "Use distinct evidence attachments.",
    ),
});
export const billingConfirmSchema = z
  .strictObject({
    expectedVersion: z.number().int().min(0).max(2147483646),
    expectedReviewVersion: z.number().int().min(0).max(2147483646),
    acceptedTerms: z.literal(true),
    profile: billingProfileObjectSchema.omit({
      declaration: true,
      evidence: true,
    }),
  })
  .superRefine(({ profile }, ctx) => {
    if (
      !profile.legalName ||
      !profile.address.line1 ||
      !profile.address.city ||
      !profile.address.region ||
      !profile.address.postalCode ||
      profile.address.country !== "IN" ||
      !profile.invoiceContact.name ||
      !profile.invoiceContact.email ||
      profile.businessStatus === "unknown" ||
      profile.taxIdentifierStatus === "unknown"
    )
      ctx.addIssue({
        code: "custom",
        message: "Complete the Indian billing details.",
      });
    if (
      !indiaStateCode(profile.address.region) ||
      !/^[1-9][0-9]{5}$/.test(profile.address.postalCode)
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a state and enter a six-digit PIN code.",
      });
    if (profile.indiaTaxTreatment !== "standard")
      ctx.addIssue({
        code: "custom",
        message: "SEZ and special tax cases need a separate review.",
      });
    if (
      profile.taxIdentifierStatus === "provided" &&
      (profile.taxIdentifiers.length !== 1 ||
        profile.taxIdentifiers[0]?.country !== "IN" ||
        profile.taxIdentifiers[0]?.kind !== "GSTIN" ||
        !validGstin(profile.taxIdentifiers[0]?.value ?? "") ||
        profile.taxIdentifiers[0]?.value.slice(0, 2) !==
          indiaStateCode(profile.address.region))
    )
      ctx.addIssue({
        code: "custom",
        message: "Check the GSTIN or select no GST registration.",
      });
    if (
      profile.taxIdentifierStatus !== "provided" &&
      profile.taxIdentifiers.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Remove the GSTIN when not registered.",
      });
  });
export type BillingConfirm = z.infer<typeof billingConfirmSchema>;
export function hasBillingDeclaration(
  current: BillingRevision | null,
): boolean {
  if (!current) return false;
  const { declaration, evidence, ...facts } = current.profile;
  return Boolean(
    declaration &&
    evidence.length === 0 &&
    declaration.actorId === current.actorId &&
    declaration.at === current.at &&
    billingConfirmSchema.safeParse({
      expectedVersion: 0,
      expectedReviewVersion: 0,
      acceptedTerms: true,
      profile: facts,
    }).success,
  );
}
export const billingEvidenceSnapshotSchema = z.object({
  fileId: z.uuid(),
  name: z.string(),
  sha256: z.string(),
  retentionUntil: z.iso.datetime(),
});
export const billingRevisionSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  version: z.number().int().positive(),
  profile: billingProfileSchema,
  evidence: z.array(billingEvidenceSnapshotSchema),
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
  note: z.string(),
});
export const billingReviewInputSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive().max(2147483646),
    expectedReviewVersion: z.number().int().nonnegative().max(2147483646),
    outcome: z.enum(["missing", "conflicting", "reviewed"]),
    findings: z.array(z.string().trim().min(1).max(1000)).max(40),
    note: z.string().trim().min(1).max(1000),
  })
  .superRefine((value, ctx) => {
    if ((value.outcome === "reviewed") !== (value.findings.length === 0))
      ctx.addIssue({
        code: "custom",
        message: "Record findings for unresolved evidence only.",
      });
  });
export const billingReviewSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  profileId: z.uuid(),
  profileVersion: z.number().int().positive(),
  version: z.number().int().positive(),
  outcome: billingReviewInputSchema.shape.outcome,
  findings: z.array(z.string()),
  note: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  at: z.iso.datetime(),
});
export const billingWorkspaceSchema = z.object({
  version: z.number().int().nonnegative(),
  current: billingRevisionSchema.nullable(),
  history: z.array(billingRevisionSchema),
  status: z.enum(["missing", "conflicting", "pending_review", "reviewed"]),
  issues: z.array(z.string()),
  currency: z.enum(["INR", "USD"]).nullable(),
  classification: z.enum(["india", "international", "unknown"]),
  reviewVersion: z.number().int().nonnegative(),
  reviews: z.array(billingReviewSchema),
});
export const billingQueueSchema = z.array(
  z.object({
    businessId: z.uuid(),
    workspace: billingWorkspaceSchema,
    status: billingWorkspaceSchema.shape.status,
  }),
);
export type BillingProfile = z.infer<typeof billingProfileSchema>;
export type BillingSave = z.infer<typeof billingSaveSchema>;
export type BillingRevision = z.infer<typeof billingRevisionSchema>;
export type BillingWorkspace = z.infer<typeof billingWorkspaceSchema>;
export type BillingReviewInput = z.infer<typeof billingReviewInputSchema>;
export type BillingReview = z.infer<typeof billingReviewSchema>;
export type BillingQueue = z.infer<typeof billingQueueSchema>;

export function billingState(
  history: BillingRevision[],
  reviews: BillingReview[] = [],
): BillingWorkspace {
  const current = history.at(-1) ?? null;
  const profile = current?.profile;
  const issues: string[] = [];
  const declared = hasBillingDeclaration(current);
  if (!profile?.legalName) issues.push("legal_name");
  if (
    !profile?.address.line1 ||
    !profile.address.city ||
    !profile.address.country
  )
    issues.push("billing_address");
  if (!profile?.invoiceContact.name || !profile.invoiceContact.email)
    issues.push("invoice_contact");
  if (!profile || profile.businessStatus === "unknown")
    issues.push("business_status");
  if (!profile || profile.taxIdentifierStatus === "unknown")
    issues.push("tax_identifier_status");
  if (
    profile?.taxIdentifierStatus === "provided" &&
    !profile.taxIdentifiers.length
  )
    issues.push("tax_identifiers");
  for (const kind of ["legal_identity", "billing_address", "business_status"])
    if (!declared && !profile?.evidence.some((entry) => entry.kind === kind))
      issues.push(`${kind}_evidence`);
  if (
    !declared &&
    profile?.taxIdentifierStatus === "provided" &&
    !profile.evidence.some((entry) => entry.kind === "tax_identifier")
  )
    issues.push("tax_identifier_evidence");
  const billingCountry = profile?.address.country;
  const latestReview = reviews
    .filter((review) => review.profileId === current?.id)
    .at(-1);
  const taxKeys =
    profile?.taxIdentifiers.map(
      (entry) => `${entry.country}:${entry.kind.toLowerCase()}`,
    ) ?? [];
  const conflicting =
    new Set(taxKeys).size !== taxKeys.length ||
    (profile?.taxIdentifierStatus !== "provided" &&
      Boolean(profile?.taxIdentifiers.length));
  if (conflicting) issues.push("conflicting_tax_identifiers");
  if (latestReview && latestReview.outcome !== "reviewed")
    issues.push(...latestReview.findings);
  return {
    version: current?.version ?? 0,
    current,
    history,
    issues,
    status:
      conflicting || latestReview?.outcome === "conflicting"
        ? "conflicting"
        : issues.length
          ? "missing"
          : latestReview?.outcome === "reviewed"
            ? "reviewed"
            : "pending_review",
    classification: !billingCountry
      ? "unknown"
      : billingCountry === "IN"
        ? "india"
        : "international",
    currency: !billingCountry ? null : billingCountry === "IN" ? "INR" : "USD",
    reviewVersion: reviews.at(-1)?.version ?? 0,
    reviews,
  };
}
