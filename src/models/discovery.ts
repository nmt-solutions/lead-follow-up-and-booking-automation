import { z } from "zod";
import { buyerCategorySchema } from "./configuration";

const text = z.string().trim().min(1).max(200);
const units = z.number().int().min(1).max(1_000_000);
export const discoveryPolicySchema = z.strictObject({
  adapterId: text,
  activeMarkets: z.array(text).min(1).max(30),
  coverage: z
    .array(z.strictObject({ market: text, source: z.literal("public_web") }))
    .min(1)
    .max(30),
  allowanceUnit: text,
  maxRunBudget: units,
  searchUnits: units,
  reviewUnits: units,
  concurrency: z.number().int().min(1).max(4),
  maxResults: z.number().int().min(1).max(10),
  deadlineMs: z.number().int().min(100).max(120_000),
  permissions: z.strictObject({
    retainEvidence: z.literal(true),
    retainQueries: z.boolean(),
    displayEvidence: z.literal(true),
    exportEvidence: z.literal(true),
    afterCancellation: z.literal(true),
    privateAiContext: z.literal(true),
  }),
});
export type DiscoveryPolicy = z.infer<typeof discoveryPolicySchema>;
export const startDiscoverySchema = z.strictObject({
  markets: z
    .array(text)
    .min(1)
    .max(30)
    .refine((values) => new Set(values).size === values.length),
  publicOffering: z.string().trim().min(1).max(400),
  confirmPublicQuery: z.literal(true),
  budget: units,
  requestKey: z.uuid(),
});
export type StartDiscovery = z.infer<typeof startDiscoverySchema>;
export const allowanceApprovalSchema = z.strictObject({
  runId: z.uuid(),
  requestKey: z.uuid(),
  expectedBudget: units,
  budget: units,
  confirmExtraUsage: z.literal(true),
});
export const resumeDiscoverySchema = z.strictObject({
  runId: z.uuid(),
  requestKey: z.uuid(),
  expectedAttempt: z.number().int().nonnegative(),
  confirmResume: z.literal(true),
});
export const cancelDiscoverySchema = z.strictObject({
  runId: z.uuid(),
  requestKey: z.uuid(),
  expectedAttempt: z.number().int().nonnegative(),
});
export type DiscoveryCommand =
  | ({ action: "increase" } & z.infer<typeof allowanceApprovalSchema>)
  | ({ action: "resume" } & z.infer<typeof resumeDiscoverySchema>)
  | ({ action: "cancel" } & z.infer<typeof cancelDiscoverySchema>);
const stopReasonSchema = z.enum([
  "completed",
  "budget_exhausted",
  "provider_unavailable",
  "provider_rate_limited",
  "provider_permission_denied",
  "invalid_provider_response",
  "interrupted",
  "defect",
  "authorization_revoked",
  "configuration_changed",
  "queue_unavailable",
  "worker_lost",
  "cancelled",
]);
export const discoveryAuditSchema = z.strictObject({
  id: z.uuid(),
  action: z.enum(["increase", "resume", "cancel"]),
  actorId: z.string(),
  budgetBefore: units,
  budgetAfter: units,
  stopReason: stopReasonSchema.nullable(),
  at: z.iso.datetime(),
});
export const workSchema = z.strictObject({
  businessId: z.uuid(),
  runId: z.uuid(),
  userId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256),
  executionKey: z.uuid(),
});
export type DiscoveryWork = z.infer<typeof workSchema>;
export type WorkIdentity = Pick<DiscoveryWork, "userId" | "sessionId">;
export type DiscoveryBrief = {
  offering: string;
  publicOffering: string;
  requirements: {
    specifications: string;
    minimumOrder: string;
    deliveryConstraints: string;
    serviceConstraints: string;
  };
  buyers: z.infer<typeof buyerCategorySchema>[];
  markets: string[];
  exclusions: string[];
  homeMarket: string;
};
// No arbitrary provider URL, private credentials, or page-directed capabilities.
export const evidenceUrlSchema = z
  .url()
  .max(2048)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.port &&
      url.hostname.includes(".") &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(
        url.hostname,
      ) &&
      !url.hostname.startsWith("[")
    );
  });
export const searchResultSchema = z.strictObject({
  name: text,
  market: text,
  url: evidenceUrlSchema,
  excerpt: z.string().trim().min(1).max(4000),
});
const quoteSchema = z.string().trim().min(1).max(500);
const contactRouteSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("email"),
    value: z.email().max(254),
    quote: quoteSchema,
  }),
  z.strictObject({
    kind: z.literal("phone"),
    value: z.string().regex(/^\+[1-9]\d{7,14}$/),
    quote: quoteSchema,
  }),
  z.strictObject({
    kind: z.literal("contact_form"),
    value: evidenceUrlSchema,
    quote: quoteSchema,
  }),
]);
export const contactCandidateSchema = z.strictObject({
  name: text.nullable(),
  nameQuote: quoteSchema.nullable(),
  roleEvidence: z
    .strictObject({ role: z.enum(["purchasing", "owner"]), quote: quoteSchema })
    .nullable(),
  route: contactRouteSchema.nullable(),
});
export const contactEvidenceSchema = contactCandidateSchema.extend({
  id: z.string().optional(),
  url: evidenceUrlSchema,
  checkedAt: z.iso.datetime(),
});
export type ContactEvidence = z.infer<typeof contactEvidenceSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export const companyEvidenceSchema = z.strictObject({
  name: text,
  website: evidenceUrlSchema.refine((value) => new URL(value).pathname === "/"),
  quote: quoteSchema,
});
export const reviewResultSchema = z.strictObject({
  relevant: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  evidenceQuote: z.string().trim().min(1).max(500),
  uncertainty: z.string().trim().min(1).max(1000),
  contacts: z.array(z.unknown()).max(5).default([]),
  company: companyEvidenceSchema.nullable().default(null),
  request: z
    .strictObject({
      quote: z.string().trim().min(1).max(500),
      publishedAt: z.iso.date().nullable().default(null),
      dateQuote: z.string().trim().min(1).max(500).nullable().default(null),
      status: z.enum(["open", "expired", "unknown"]),
      statusQuote: z.string().trim().min(1).max(500).nullable().default(null),
      expiresAt: z.iso.datetime().nullable().default(null),
      expiryQuote: quoteSchema.nullable().default(null),
      reference: z
        .strictObject({ url: evidenceUrlSchema, quote: quoteSchema })
        .nullable()
        .default(null),
    })
    .nullable(),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type SearchInput = {
  businessId: string;
  runId: string;
  operationId: string;
  offering: string;
  buyer: DiscoveryBrief["buyers"][number];
  market: string;
  limit: number;
  signal: AbortSignal;
};
export type ReviewInput = {
  businessId: string;
  runId: string;
  operationId: string;
  brief: DiscoveryBrief;
  buyer: DiscoveryBrief["buyers"][number];
  source: SearchResult;
  instruction: string;
  signal: AbortSignal;
};
export type DiscoveryProvider = {
  id: string;
  search(input: SearchInput): Promise<unknown>;
  review(input: ReviewInput): Promise<unknown>;
};
export class DiscoveryProviderFailure extends Error {
  constructor(
    readonly reason:
      "unavailable" | "rate_limited" | "permission_denied" | "invalid_response",
  ) {
    super(reason);
  }
}
export type RunStatus = "queued" | "running" | "completed" | "stopped";
export type StopReason =
  | "completed"
  | "budget_exhausted"
  | "provider_unavailable"
  | "provider_rate_limited"
  | "provider_permission_denied"
  | "invalid_provider_response"
  | "interrupted"
  | "defect"
  | "authorization_revoked"
  | "configuration_changed"
  | "queue_unavailable"
  | "worker_lost"
  | "cancelled";
// Defaults read #10 snapshots conservatively; no backfilled role/currentness claims.
export const persistedProspectSchema = z.strictObject({
  name: text,
  market: text,
  buyer: buyerCategorySchema,
  relationship: z.literal("potential_buyer"),
  matchReason: z.string().trim().min(1).max(1000),
  uncertainty: z.string().trim().min(1).max(1000),
  company: companyEvidenceSchema.nullable().default(null),
  request: reviewResultSchema.shape.request,
  identityConflict: z.boolean().default(false),
  contacts: z.array(contactEvidenceSchema).max(5).default([]),
  evidence: z
    .array(
      z.strictObject({
        url: evidenceUrlSchema,
        quote: quoteSchema,
        checkedAt: z.iso.datetime(),
      }),
    )
    .min(1)
    .max(10),
});
export type DiscoveryProspect = z.infer<typeof persistedProspectSchema> & {
  id: string;
};
export type ProspectView = DiscoveryProspect & {
  contactStatus: "buyer_contact" | "general_business_contact" | "missing";
  requestState: "open" | "expired" | "undated" | "uncertain" | null;
  companyId: string | null;
  firstCheckedAt: string;
  lastCheckedAt: string;
  reviewReasons: string[];
  history: ObservationView[];
  sourceChecks: SourceCheck[];
};
export const sourceCheckSchema = z.strictObject({
  runId: z.uuid(),
  url: evidenceUrlSchema,
  checkedAt: z.iso.datetime(),
});
export type SourceCheck = z.infer<typeof sourceCheckSchema>;
export const observationOutcomeSchema = z.enum([
  "created",
  "refreshed",
  "duplicate",
  "legacy",
]);
export type ObservationOutcome = z.infer<typeof observationOutcomeSchema>;
export type ObservationView = {
  id: string;
  runId: string;
  checkedAt: string;
  outcome: ObservationOutcome;
  current: boolean;
  data: z.infer<typeof persistedProspectSchema>;
};
const consolidationSchema = z.strictObject({
  rawResults: z.number().int().nonnegative().nullable(),
  matchedObservations: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  refreshed: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});
const countsSchema = z.strictObject({
  evidenceBacked: z.number().int().nonnegative(),
  potentialBuyers: z.number().int().nonnegative(),
  openBuyingRequests: z.number().int().nonnegative(),
  contactable: z.number().int().nonnegative(),
  namedBuyers: z.number().int().nonnegative(),
});
export type DiscoveryUsage = {
  id: string;
  kind: "search" | "review";
  units: number;
  outcome: "reserved" | "succeeded" | "failed" | "uncertain";
  query: string | null;
  at: string;
  returnedResults: number | null;
};
export type DiscoveryRun = {
  id: string;
  businessId: string;
  brief: DiscoveryBrief;
  policy: DiscoveryPolicy;
  createdBy: string;
  sessionId: string;
  requestKey: string;
  executionId: string | null;
  executionUserId: string | null;
  attempt: number;
  completedSearchKeys: string[];
  status: RunStatus;
  stopReason: StopReason | null;
  budget: number;
  used: number;
  completedSteps: number;
  createdAt: Date;
  updatedAt: Date;
};
export type RunView = Omit<
  DiscoveryRun,
  | "sessionId"
  | "executionUserId"
  | "completedSearchKeys"
  | "executionId"
  | "requestKey"
  | "policy"
  | "createdAt"
  | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
  allowanceUnit: string;
  consumed: number;
  reserved: number;
  remaining: number;
  maxBudget: number;
  resumable: boolean;
  audit: z.infer<typeof discoveryAuditSchema>[];
  prospects: ProspectView[];
  counts: z.infer<typeof countsSchema>;
  usage: DiscoveryUsage[];
  consolidation: z.infer<typeof consolidationSchema>;
};
export type DiscoveryWorkspace = {
  canRun: boolean;
  setup: string[];
  policy: DiscoveryPolicy | null;
  availableMarkets: string[];
  offering: string;
  brief: DiscoveryBrief | null;
  runs: RunView[];
  prospects: ProspectView[];
  counts: z.infer<typeof countsSchema>;
};

const prospectViewSchema = persistedProspectSchema.extend({
  contacts: z.array(contactEvidenceSchema),
  evidence: z.array(persistedProspectSchema.shape.evidence.element).min(1),
  id: z.uuid(),
  contactStatus: z.enum([
    "buyer_contact",
    "general_business_contact",
    "missing",
  ]),
  requestState: z.enum(["open", "expired", "undated", "uncertain"]).nullable(),
  companyId: z.string().nullable(),
  firstCheckedAt: z.iso.datetime(),
  lastCheckedAt: z.iso.datetime(),
  reviewReasons: z.array(z.string()),
  history: z.array(
    z.strictObject({
      id: z.string(),
      runId: z.uuid(),
      checkedAt: z.iso.datetime(),
      outcome: observationOutcomeSchema,
      current: z.boolean(),
      data: persistedProspectSchema,
    }),
  ),
  sourceChecks: z.array(sourceCheckSchema),
});

const briefSchema = z.strictObject({
  offering: z.string().max(4000),
  publicOffering: z.string().max(400),
  requirements: z.strictObject({
    specifications: z.string().max(4000),
    minimumOrder: z.string().max(500),
    deliveryConstraints: z.string().max(2000),
    serviceConstraints: z.string().max(2000),
  }),
  buyers: z.array(buyerCategorySchema).max(30),
  markets: z.array(text).max(30),
  exclusions: z.array(z.string().max(300)).max(50),
  homeMarket: z.string().max(200),
});

export const discoveryWorkspaceSchema: z.ZodType<DiscoveryWorkspace> =
  z.strictObject({
    canRun: z.boolean(),
    setup: z.array(z.string()),
    policy: discoveryPolicySchema.nullable(),
    availableMarkets: z.array(text),
    offering: z.string(),
    brief: briefSchema.nullable(),
    prospects: z.array(prospectViewSchema),
    counts: countsSchema,
    runs: z.array(
      z.strictObject({
        id: z.uuid(),
        businessId: z.uuid(),
        brief: briefSchema,
        createdBy: z.string(),
        status: z.enum(["queued", "running", "completed", "stopped"]),
        stopReason: stopReasonSchema.nullable(),
        budget: units,
        used: z.number().int().nonnegative(),
        completedSteps: z.number().int().nonnegative(),
        allowanceUnit: text,
        attempt: z.number().int().nonnegative(),
        consumed: z.number().int().nonnegative(),
        reserved: z.number().int().nonnegative(),
        remaining: z.number().int().nonnegative(),
        maxBudget: units,
        resumable: z.boolean(),
        audit: z.array(discoveryAuditSchema),
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        counts: countsSchema,
        consolidation: consolidationSchema,
        prospects: z.array(prospectViewSchema),
        usage: z.array(
          z.strictObject({
            id: z.uuid(),
            kind: z.enum(["search", "review"]),
            units,
            outcome: z.enum(["reserved", "succeeded", "failed", "uncertain"]),
            query: z.string().nullable(),
            at: z.iso.datetime(),
            returnedResults: z.number().int().nonnegative().nullable(),
          }),
        ),
      }),
    ),
  });
