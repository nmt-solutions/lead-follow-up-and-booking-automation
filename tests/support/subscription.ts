import { randomUUID } from "node:crypto";
import type { createHarness } from "./harness";
import { createSubscriptionQuoteApplication } from "../../src/application/subscription-quotes";
import { createSubscriptionQuoteRepository } from "../../src/db/subscription-quote-repository";
import { createBillingApplication } from "../../src/application/billing";
import { createBillingRepository } from "../../src/db/billing-repository";
import { createTaxApplication } from "../../src/application/tax";
import { createTaxRepository } from "../../src/db/tax-repository";
import { runtimeDatabase } from "../../src/db/runtime";
import { createFileApplication } from "../../src/application/files";
import { createFileRepository } from "../../src/db/file-repository";
import { createMemoryStorage } from "./storage";

export async function subscriptionFixture(
  h: Awaited<ReturnType<typeof createHarness>>,
  options: {
    reservedCapacity?: {
      id: string;
      label: string;
      capacity: { quantity: number; unit: string };
      prices: {
        INR: { monthlyMinor: number; pilotMinor: number | null };
        USD: null;
      };
    };
    country?: string;
    discovery?: number;
    automation?: number;
    automationUnit?: string;
    term?: "monthly" | "paid_pilot";
    mode?: "fixture" | "live";
    catalogVersion?: number;
    ruleKey?: string;
    billingEvidenceRetentionSeconds?: number;
  } = {},
) {
  const database = runtimeDatabase(h.runtime);
  const dependencies = {
    authenticate: h.authenticate,
    authenticatePlatform: h.access.authenticatePlatform,
    clock: h.clock,
  };
  const billing = createBillingApplication({
    ...dependencies,
    repository: createBillingRepository(database),
  });
  const tax = createTaxApplication({
    ...dependencies,
    repository: createTaxRepository(database),
    mode: options.mode ?? "fixture",
  });
  async function setup(country = "IN") {
    const owner = await h.signIn("tax-owner@example.com");
    const operator = await h.signIn("tax-operator@example.com");
    await h.provisionOperator(operator, { tax: true, reconciliation: false });
    const business = await h.application.createBusiness(owner, {
      name: "Fixture Business",
      offering: "Steel",
      homeMarket: "Pune",
      website: "",
    });
    const files = createFileApplication({
      authenticate: h.authenticate,
      repository: createFileRepository(runtimeDatabase(h.runtime)),
      clock: h.clock,
      storage: createMemoryStorage(),
      policy: {
        maxBytes: 1024,
        allowedTypes: ["text/plain"],
        uploadTtlSeconds: 60,
        accessTtlSeconds: 30,
        retentionSeconds: options.billingEvidenceRetentionSeconds ?? 3600,
        operationTimeoutSeconds: 5,
        cleanupGraceSeconds: 60,
        recordRetentionSeconds: 3600,
        accountScope: "tax-fixture",
      },
    });
    const upload = await files.beginUpload(owner, business.id, {
      name: "fixture.txt",
      contentType: "text/plain",
      size: 5,
      purpose: "billing",
    });
    await files.completeUpload(
      owner,
      business.id,
      upload.file.id,
      upload.token,
      new TextEncoder().encode("legal"),
    );
    await billing.save(owner, business.id, {
      expectedVersion: 0,
      note: "Synthetic billing evidence",
      profile: {
        legalName: "Synthetic buyer",
        registrationNumber: "fixture-only",
        address: {
          line1: "Fixture address",
          line2: "",
          city: "Fixture city",
          region: "MH",
          postalCode: "00000",
          country,
        },
        invoiceContact: { name: "Accounts", email: "accounts@example.com" },
        businessStatus: "business",
        taxIdentifierStatus: "not_applicable",
        taxIdentifiers: [],
        evidence: ["legal_identity", "billing_address", "business_status"].map(
          (kind) => ({
            kind,
            fileId: upload.file.id,
            note: "Synthetic fixture claim",
          }),
        ),
      },
    });
    await billing.review(operator, business.id, {
      expectedVersion: 1,
      expectedReviewVersion: 0,
      outcome: "reviewed",
      findings: [],
      note: "Synthetic evidence reviewed; treatment is separate",
    });
    return { owner, operator, business, files, fileId: upload.file.id };
  }

  const rule = {
    mode: options.mode ?? "fixture",
    customerCountry: "IN",
    customerRegion: null,
    buyerStatus: "business",
    currency: "INR",
    productCode: "subscription",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveUntil: null,
    jurisdiction: {
      code: "fixture-domestic",
      name: "Synthetic domestic jurisdiction",
      country: "IN",
    },
    registration: {
      status: "registered",
      identifier: "TEST-ONLY",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      effectiveUntil: null,
    },
    treatment: "taxable",
    rationale: "Synthetic example, no legal rate or registration assertion",
    requiredEvidence: ["legal_identity", "billing_address", "business_status"],
    rates: [{ name: "Synthetic tax", numerator: "1", denominator: "10" }],
    rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
    evidence: [
      {
        title: "Synthetic fixture policy",
        reference: "fixture:domestic-v1",
        checkedAt: "2026-11-05T08:00:00.000Z",
      },
    ],
  };

  const f = await setup(options.country ?? "IN");
  const actor = await h.authenticate(f.operator);
  await h.admin.query(
    "UPDATE platform_operator SET pricing=true, reconciliation=true WHERE user_id=$1",
    [actor.userId],
  );
  const rules = await tax.saveRule(f.operator, {
    key: options.ruleKey ?? "fixture",
    expectedVersion: 0,
    note: "Synthetic fixture only",
    rule: {
      ...rule,
      customerCountry: options.country ?? "IN",
      currency: options.country === "US" ? "USD" : "INR",
    },
  });
  await tax.decideRule(f.operator, {
    revisionId: rules.revisions.find(
      (r) => r.key === (options.ruleKey ?? "fixture"),
    )!.id,
    expectedDecisionVersion: 0,
    outcome: "approved",
    note: "Synthetic fixture approval",
  });
  if (options.reservedCapacity) {
    const capacityRules = await tax.saveRule(f.operator, {
      key: `${options.ruleKey ?? "fixture"}-capacity`,
      expectedVersion: 0,
      note: "Synthetic capacity tax fixture",
      rule: {
        ...rule,
        productCode: "reserved_capacity",
        customerCountry: options.country ?? "IN",
        currency: options.country === "US" ? "USD" : "INR",
      },
    });
    await tax.decideRule(f.operator, {
      revisionId: capacityRules.revisions.find(
        (r) => r.key === `${options.ruleKey ?? "fixture"}-capacity`,
      )!.id,
      expectedDecisionVersion: 0,
      outcome: "approved",
      note: "Synthetic capacity treatment approval",
    });
  }
  const quotes = createSubscriptionQuoteApplication({
    ...dependencies,
    repository: createSubscriptionQuoteRepository(database),
  });
  await quotes.configure(f.operator, {
    expectedVersion: options.catalogVersion ?? 0,
    effectiveFrom: null,
    note: "Explicit synthetic commercial inputs",
    offers: [
      {
        id: "fixture",
        label: "Fixture reach",
        markets: ["Pune", "United States"],
        discovery: {
          quantity: options.discovery ?? 100,
          unit: "research units",
        },
        automation: {
          quantity: options.automation ?? 100,
          unit: options.automationUnit ?? "provider calls",
        },
        prices: {
          INR: { monthlyMinor: 10005, pilotMinor: 1000 },
          USD: { monthlyMinor: 2500, pilotMinor: 500 },
        },
        pilot: {
          days: 14,
          discovery: { quantity: 10, unit: "research units" },
          automation: { quantity: 10, unit: "provider calls" },
        },
        renewalTerms:
          "Explicit fixture calendar monthly term; no automatic renewal authorized here",
        reservedCapacity: options.reservedCapacity
          ? [options.reservedCapacity]
          : [],
      },
    ],
  });
  const quote = await quotes.createQuote(f.owner, f.business.id, {
    offerId: "fixture",
    reservedCapacityId: options.reservedCapacity?.id ?? null,
    term: options.term ?? "monthly",
    expectedCatalogVersion: (options.catalogVersion ?? 0) + 1,
    expectedBillingVersion: 1,
    expectedReviewVersion: 1,
    requestKey: randomUUID(),
  });
  return { ...f, quote: quote.snapshot, quotes, billing, tax, rules };
}
