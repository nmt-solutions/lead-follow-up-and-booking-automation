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
export type SearchResult = z.infer<typeof searchResultSchema>;
export const reviewResultSchema = z.strictObject({
  relevant: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
  evidenceQuote: z.string().trim().min(1).max(500),
  uncertainty: z.string().trim().min(1).max(1000),
  request: z
    .strictObject({
      quote: z.string().trim().min(1).max(500),
      publishedAt: z.iso.date().nullable().default(null),
      dateQuote: z.string().trim().min(1).max(500).nullable().default(null),
      status: z.enum(["open", "expired", "unknown"]),
      statusQuote: z.string().trim().min(1).max(500).nullable().default(null),
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
  | "worker_lost";
export type DiscoveryProspect = {
  id: string;
  name: string;
  market: string;
  buyer: DiscoveryBrief["buyers"][number];
  relationship: "potential_buyer";
  matchReason: string;
  uncertainty: string;
  request: ReviewResult["request"];
  evidence: { url: string; quote: string; checkedAt: string }[];
};
export type DiscoveryUsage = {
  id: string;
  kind: "search" | "review";
  units: number;
  outcome: "reserved" | "succeeded" | "failed" | "uncertain";
  query: string | null;
  at: string;
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
  | "executionId"
  | "requestKey"
  | "policy"
  | "createdAt"
  | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
  allowanceUnit: string;
  prospects: DiscoveryProspect[];
  usage: DiscoveryUsage[];
};
export type DiscoveryWorkspace = {
  canRun: boolean;
  setup: string[];
  policy: DiscoveryPolicy | null;
  availableMarkets: string[];
  offering: string;
  brief: DiscoveryBrief | null;
  runs: RunView[];
};

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
]);
export const discoveryWorkspaceSchema: z.ZodType<DiscoveryWorkspace> =
  z.strictObject({
    canRun: z.boolean(),
    setup: z.array(z.string()),
    policy: discoveryPolicySchema.nullable(),
    availableMarkets: z.array(text),
    offering: z.string(),
    brief: briefSchema.nullable(),
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
        createdAt: z.iso.datetime(),
        updatedAt: z.iso.datetime(),
        prospects: z.array(
          z.strictObject({
            id: z.uuid(),
            name: text,
            market: text,
            buyer: buyerCategorySchema,
            relationship: z.literal("potential_buyer"),
            matchReason: z.string().max(1000),
            uncertainty: z.string().max(1000),
            request: reviewResultSchema.shape.request,
            evidence: z.array(
              z.strictObject({
                url: evidenceUrlSchema,
                quote: z.string().max(500),
                checkedAt: z.iso.datetime(),
              }),
            ),
          }),
        ),
        usage: z.array(
          z.strictObject({
            id: z.uuid(),
            kind: z.enum(["search", "review"]),
            units,
            outcome: z.enum(["reserved", "succeeded", "failed", "uncertain"]),
            query: z.string().nullable(),
            at: z.iso.datetime(),
          }),
        ),
      }),
    ),
  });
