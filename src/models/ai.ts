import { z } from "zod";
import { contactCandidateSchema, reviewResultSchema } from "./discovery";

export const aiTaskSchema = z.enum(["extraction", "drafting"]);
export type AiTask = z.infer<typeof aiTaskSchema>;
const note = z.string().trim().min(1).max(1000);
const count = z.number().int().min(1).max(1_000_000);
export const aiConfigurationSchema = z.strictObject({
  revision: z.string().trim().min(1).max(100),
  models: z
    .array(
      z.strictObject({
        id: z.string().regex(/^openai\/[a-zA-Z0-9._-]{1,100}$/),
        providers: z.array(z.literal("openai")).length(1),
        tasks: z.array(aiTaskSchema).min(1).max(2),
        structuredOutput: z.literal(true),
        maxInputChars: count,
        maxOutputTokens: count,
        evidence: note,
      }),
    )
    .min(1)
    .max(30),
  openaiFunding: z.strictObject({
    state: z.enum(["confirmed", "missing", "exhausted", "unknown"]),
    source: z.enum(["linked_api_credits", "purchased_api_credits"]),
    reference: note,
  }),
  gatewayFunding: z.strictObject({
    state: z.enum(["confirmed", "missing", "exhausted", "unknown"]),
    reference: note,
  }),
});
export type AiConfiguration = z.infer<typeof aiConfigurationSchema>;
export const aiProfileSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(120),
    configurationRevision: z.string().trim().min(1).max(100),
    providers: z.array(z.literal("openai")).length(1),
    extraction: z.strictObject({
      model: z.string().max(120),
      schema: z.literal("discovery-review-v1"),
    }),
    drafting: z.strictObject({
      model: z.string().max(120),
      schema: z.literal("sales-draft-v1"),
    }),
    limits: z.strictObject({
      maxInputChars: z.number().int().min(1).max(100_000),
      maxOutputTokens: z.number().int().min(1).max(16_000),
      maxAttempts: z.number().int().min(1).max(5),
      maxFallbackAttempts: z.number().int().min(0).max(4),
      deadlineMs: z.number().int().min(100).max(60_000),
      allowanceAttempts: count,
      fallbackAllowanceAttempts: z.number().int().min(0).max(1_000_000),
    }),
  })
  .superRefine((value, context) => {
    if (
      value.limits.maxFallbackAttempts >= value.limits.maxAttempts ||
      value.limits.fallbackAllowanceAttempts > value.limits.allowanceAttempts ||
      (value.limits.maxFallbackAttempts === 0 &&
        value.limits.fallbackAllowanceAttempts !== 0)
    )
      context.addIssue({
        code: "custom",
        message: "Fallback must fit the combined allowance and attempt cap",
      });
  });
export type AiProfile = z.infer<typeof aiProfileSchema>;
export const aiDraftSchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  profile: aiProfileSchema,
  note,
});
export const aiSampleSchema = z.discriminatedUnion("task", [
  z.strictObject({
    task: z.literal("extraction"),
    label: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(40_000),
  }),
  z.strictObject({
    task: z.literal("drafting"),
    label: z.string().trim().min(1).max(120),
    text: z.string().trim().min(1).max(40_000),
  }),
]);
export type AiSample = z.infer<typeof aiSampleSchema>;
export const aiPreviewSchema = z.strictObject({
  profileId: z.uuid(),
  requestKey: z.uuid(),
  expectedKnowledgeVersion: z.number().int().positive(),
  confirmReviewedInput: z.literal(true),
  confirmBusinessContext: z.literal(true),
  sample: aiSampleSchema,
});
export const aiReviewSchema = z.strictObject({
  executionId: z.uuid(),
  accepted: z.boolean(),
  confirmRepresentative: z.literal(true),
  note,
});
export const aiActivateSchema = z.strictObject({
  profileId: z.uuid(),
  expectedActivationVersion: z.number().int().nonnegative(),
  note,
});

export const extractionOutputSchema = reviewResultSchema.extend({
  contacts: z.array(contactCandidateSchema).max(5),
});
export const draftingOutputSchema = z.strictObject({
  draft: z.string().trim().min(1).max(8000),
  answerIndexes: z.array(z.number().int().nonnegative()).max(30),
  needsHumanReview: z.literal(true),
});
export const aiOutputSchema = z.union([
  extractionOutputSchema,
  draftingOutputSchema,
]);
export type AiOutput = z.infer<typeof aiOutputSchema>;
export const aiFailureSchema = z.enum([
  "credentials",
  "funding",
  "rate_limited",
  "unavailable",
  "invalid_output",
  "uncertain",
  "interrupted",
  "allowance",
  "configuration_changed",
]);
export type AiFailure = z.infer<typeof aiFailureSchema>;
export type AiRoute = "operator_byok" | "gateway_system";
const metrics = z.strictObject({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  // These are separate provider-reported meters. Neither implies a subscription charge or an invoice.
  providerCostUsd: z.number().finite().nonnegative().nullable(),
  gatewayCostUsd: z.number().finite().nonnegative().nullable(),
  credentialSource: z.enum(["operator_api_key", "gateway_system", "unknown"]),
  provider: z.literal("openai").nullable(),
  model: z.string().max(120).nullable(),
  generationId: z
    .string()
    .regex(/^[a-zA-Z0-9_.:-]{1,160}$/)
    .nullable(),
});
export type AiMetrics = z.infer<typeof metrics>;
export const aiProviderResultSchema = z.strictObject({
  output: z.unknown(),
  metrics,
});
export const unknownAiMetrics: AiMetrics = {
  inputTokens: null,
  outputTokens: null,
  providerCostUsd: null,
  gatewayCostUsd: null,
  credentialSource: "unknown",
  provider: null,
  model: null,
  generationId: null,
};
export class AiProviderFailure extends Error {
  constructor(
    readonly reason: AiFailure,
    readonly metrics: AiMetrics = unknownAiMetrics,
  ) {
    super(reason);
  }
}
export type AiProvider = {
  readiness(): { primary: boolean; fallback: boolean };
  generate(input: {
    route: AiRoute;
    task: AiTask;
    model: string;
    profile: AiProfile;
    system: string;
    input: string;
    signal: AbortSignal;
  }): Promise<unknown>;
};
export const aiProfileViewSchema = z.strictObject({
  id: z.uuid(),
  version: z.number().int().positive(),
  profile: aiProfileSchema,
  actorId: z.string(),
  at: z.iso.datetime(),
  note,
  usedAttempts: z.number().int().nonnegative(),
  usedFallbackAttempts: z.number().int().nonnegative(),
});
export type AiProfileView = z.infer<typeof aiProfileViewSchema>;
export const aiExecutionViewSchema = z.strictObject({
  id: z.uuid(),
  profileId: z.uuid(),
  task: aiTaskSchema,
  kind: z.enum(["preview", "workflow"]),
  knowledgeVersion: z.number().int().positive(),
  sample: aiSampleSchema,
  at: z.iso.datetime(),
  actorId: z.string(),
  status: z.enum([
    "running",
    "succeeded",
    "failed",
    "uncertain",
    "setup_required",
  ]),
  failure: aiFailureSchema.nullable(),
  output: aiOutputSchema.nullable(),
  review: z
    .strictObject({
      accepted: z.boolean(),
      actorId: z.string(),
      at: z.iso.datetime(),
      note,
    })
    .nullable(),
  attempts: z.array(
    z.strictObject({
      id: z.uuid(),
      number: z.number().int().positive(),
      route: z.enum(["operator_byok", "gateway_system"]),
      outcome: z.enum(["succeeded", "failed", "uncertain"]),
      failure: aiFailureSchema.nullable(),
      at: z.iso.datetime(),
      latencyMs: z.number().int().nonnegative().nullable(),
      metrics,
      fundingSource: z.enum([
        "linked_api_credits",
        "purchased_api_credits",
        "gateway_credits",
      ]),
      fundingReference: note,
    }),
  ),
});
export type AiExecutionView = z.infer<typeof aiExecutionViewSchema>;
export const aiWorkspaceSchema = z.strictObject({
  activationHistory: z.array(
    z.strictObject({
      version: z.number().int().positive(),
      profileId: z.uuid(),
      actorId: z.string(),
      at: z.iso.datetime(),
      note,
    }),
  ),
  profiles: z.array(aiProfileViewSchema),
  executions: z.array(aiExecutionViewSchema),
  activation: z.strictObject({
    version: z.number().int().nonnegative(),
    profileId: z.uuid().nullable(),
  }),
  setup: z.array(z.string()),
  configuration: aiConfigurationSchema.nullable(),
  knowledgeVersion: z.number().int().positive().nullable(),
});
export type AiWorkspace = z.infer<typeof aiWorkspaceSchema>;
