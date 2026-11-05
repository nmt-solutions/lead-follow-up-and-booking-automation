import { randomUUID } from "node:crypto";
import { createAiApplication } from "../../src/application/ai";
import { createInquiryApplication } from "../../src/application/inquiries";
import { createAiRepository } from "../../src/db/ai-repository";
import { createInquiryRepository } from "../../src/db/inquiry-repository";
import {
  unknownAiMetrics,
  type AiConfiguration,
  type AiProfile,
} from "../../src/models/ai";
import type { Database } from "../../src/db/runtime";
import type { createHarness } from "./harness";
import type { createOpportunityApplication } from "../../src/application/opportunity-control";

/** Real #20 qualification and real AI policy/persistence; only external model
 * output is deterministic. No sends, live models, credentials or funding. */
export async function bookingInquiry(
  h: Awaited<ReturnType<typeof createHarness>>,
  database: Database,
  credentials: Headers,
  businessId: string,
  opportunities: ReturnType<typeof createOpportunityApplication<Headers>>,
) {
  const configuration: AiConfiguration = {
    revision: "booking-qualification-fixture",
    models: [
      {
        id: "openai/fixture-model",
        providers: ["openai"],
        tasks: ["extraction", "drafting"],
        structuredOutput: true,
        maxInputChars: 40000,
        maxOutputTokens: 2000,
        evidence: "Deterministic fixture only",
      },
    ],
    openaiFunding: {
      state: "confirmed",
      source: "purchased_api_credits",
      reference: "Fixture funding",
    },
    gatewayFunding: { state: "confirmed", reference: "Fixture funding" },
  };
  const profile: AiProfile = {
    name: "Booking qualification fixture",
    configurationRevision: configuration.revision,
    providers: ["openai"],
    extraction: {
      model: "openai/fixture-model",
      schema: "discovery-review-v1",
    },
    drafting: { model: "openai/fixture-model", schema: "sales-draft-v1" },
    limits: {
      maxInputChars: 40000,
      maxOutputTokens: 2000,
      maxAttempts: 2,
      maxFallbackAttempts: 1,
      deadlineMs: 30000,
      allowanceAttempts: 100,
      fallbackAllowanceAttempts: 20,
    },
  };
  const ai = createAiApplication({
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    authenticateWork: h.access.authenticateWork,
    repository: createAiRepository(database),
    clock: h.clock,
    configuration,
    provider: {
      readiness: () => ({ primary: true, fallback: true }),
      async generate(input) {
        const output =
          input.purpose === "inquiry"
            ? {
                kind: "inquiry",
                answerIndexes: [],
                offeringIndexes: [],
                facts: [],
                unsupported: false,
              }
            : input.task === "drafting"
              ? {
                  draft: "Collection only.",
                  answerIndexes: [],
                  needsHumanReview: true,
                }
              : {
                  relevant: true,
                  reason: "Requirement",
                  evidenceQuote: "Consultation",
                  uncertainty: "Unknown buyer",
                  company: null,
                  request: null,
                  contacts: [],
                };
        return { output, metrics: unknownAiMetrics };
      },
    },
  });
  const actor = await h.authenticate(credentials);
  await h.admin.query(
    "INSERT INTO platform_operator (user_id, ai) VALUES ($1, true) ON CONFLICT (user_id) DO UPDATE SET ai = true",
    [actor.userId],
  );
  const state = await ai.workspace(credentials, businessId);
  const draft = await ai.saveDraft(credentials, businessId, {
    expectedVersion: state.profiles.at(-1)?.version ?? 0,
    profile,
    note: "Fixture model policy",
  });
  const profileId = draft.profiles.at(-1)!.id;
  for (const task of ["extraction", "drafting"] as const) {
    const preview = await ai.preview(credentials, businessId, {
      profileId,
      requestKey: randomUUID(),
      expectedKnowledgeVersion: 2,
      confirmReviewedInput: true,
      confirmBusinessContext: true,
      sample: { task, label: "Representative", text: "Consultation" },
    });
    await ai.reviewPreview(credentials, businessId, {
      executionId: preview.id,
      accepted: true,
      confirmRepresentative: true,
      note: "Reviewed",
    });
  }
  await ai.activate(credentials, businessId, {
    profileId,
    expectedActivationVersion: draft.activation.version,
    note: "Activate fixture profile",
  });
  return createInquiryApplication({
    authenticate: h.authenticate,
    authenticateForWork: h.access.authenticateForWork,
    repository: createInquiryRepository(database, h.clock),
    clock: h.clock,
    ai,
    opportunities,
  });
}
