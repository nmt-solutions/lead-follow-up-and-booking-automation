import type { ExaPolicy } from "../../src/models/exa";

// Deterministic contract fixtures. Never use as live commercial evidence.
export const exaScope = "fixture-only-order-scope";
export const exaActivation = {
  issue2CompletionRef: "fixture-only-issue2-evidence",
  msaVersion: "fixture-version",
  orderRef: "fixture-order",
  scopeRef: exaScope,
  quoteRef: "fixture-quote-and-payment-terms",
  dataTermsRef: "fixture-data-terms",
  accountLimitsRef: "fixture-account-capabilities-and-spend-limits",
  executed: true,
  retention: "durable_without_expiry",
  attribution: "source_url",
  sourceRightsReviewRef: "fixture-source-rights-review",
  permissions: {
    publicBusinessQueries: true,
    publicBusinessContacts: true,
    retainQueries: false,
    durableFacts: true,
    evidenceExcerpts: true,
    customerDisplay: true,
    customerExport: true,
    afterCancellation: true,
    aiProcessing: true,
  },
};
export const exaPolicy: ExaPolicy = {
  scopeRef: exaScope,
  publicOfferings: ["Galvanized steel sheets"],
  buyerCategories: ["Fabricators"],
  focusedDomains: [],
  contentsType: "text",
  maxExcerptChars: 1000,
  maxContentsPerSearch: 1,
  contentsUnits: 1,
  maxCalls: 6,
  maxAttemptsPerStep: 2,
  requestTimeoutMs: 5000,
  maxAgeHours: 0,
};
