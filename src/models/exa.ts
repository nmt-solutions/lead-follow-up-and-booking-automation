import { z } from "zod";

const reference = z.string().trim().min(1).max(200);
// An operator records evidence of the executed scope; these fields do not grant
// rights or substitute public API terms for an executed order (#2).
export const exaActivationSchema = z.strictObject({
  issue2CompletionRef: reference,
  executed: z.literal(true),
  msaVersion: reference,
  orderRef: reference,
  scopeRef: reference,
  quoteRef: reference,
  dataTermsRef: reference,
  accountLimitsRef: reference,
  permissions: z.strictObject({
    publicBusinessQueries: z.literal(true),
    publicBusinessContacts: z.literal(true),
    retainQueries: z.boolean(),
    durableFacts: z.literal(true),
    evidenceExcerpts: z.literal(true),
    customerDisplay: z.literal(true),
    customerExport: z.literal(true),
    afterCancellation: z.literal(true),
    aiProcessing: z.literal(true),
  }),
  retention: z.literal("durable_without_expiry"),
  attribution: z.literal("source_url"),
  sourceRightsReviewRef: reference,
});
export type ExaActivation = z.infer<typeof exaActivationSchema>;

const publicTerm = z
  .string()
  .trim()
  .min(1)
  .max(400)
  .refine(
    (value) =>
      !/[\r\n@]|https?:|\b(?:password|secret|api[_ -]?key)\b/i.test(value),
  );
export const exaPolicySchema = z.strictObject({
  scopeRef: reference,
  // Explicit operator-reviewed vocabulary prevents arbitrary free text (including
  // named people) from being reclassified as public by a model or request body.
  publicOfferings: z.array(publicTerm).min(1).max(30),
  buyerCategories: z.array(publicTerm).min(1).max(30),
  focusedDomains: z
    .array(
      z
        .string()
        .max(253)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/),
    )
    .max(10),
  contentsType: z.enum(["text", "highlights"]),
  maxExcerptChars: z.number().int().min(1).max(4000),
  maxContentsPerSearch: z.number().int().min(1).max(10),
  contentsUnits: z.number().int().min(1).max(1_000_000),
  maxCalls: z.number().int().min(1).max(1000),
  maxAttemptsPerStep: z.number().int().min(1).max(3),
  requestTimeoutMs: z.number().int().min(100).max(90_000),
  maxAgeHours: z.number().int().min(-1).max(720),
});
export const retrievalProvenanceSchema = z.strictObject({
  provider: z.literal("exa"),
  scopeRef: reference,
  contentType: z.enum(["metadata", "text", "highlights"]),
  publishedAt: z.iso.datetime({ offset: true }).nullable(),
  contentSource: z.enum(["cached", "crawled"]).nullable(),
});
export type ExaPolicy = z.infer<typeof exaPolicySchema>;
