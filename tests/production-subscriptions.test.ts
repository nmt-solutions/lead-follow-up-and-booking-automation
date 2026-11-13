import { describe, expect, it } from "vitest";
import { publishedOffers } from "../src/content/plans";
import {
  productionSubscriptionIssues,
  publishedOfferMatches,
} from "../src/production/subscriptions";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayFixture } from "./support/razorpay";
import { createHmac, randomUUID } from "node:crypto";
import { createHarness } from "./support/harness";
import { nativeSubscriptionFixture } from "./support/native-subscription";
import { createSubscriptionPaymentApplication } from "../src/application/subscription-payments";
import { createSubscriptionPaymentRepository } from "../src/db/subscription-payment-repository";
import { runtimeDatabase } from "../src/db/runtime";
import {
  PaymentCreationNotAttempted,
  type PaymentSnapshot,
} from "../src/models/subscription-payments";
import { configuredFinancialAdjustments } from "../src/financial-adjustments/configuration";
import { exaPolicy } from "./support/exa";
import { aiProfileSchema } from "../src/models/ai";

/** Explicit synthetic approvals for testing the launch gate; no native account is changed. */
function liveConfiguration() {
  const clock = { now: () => new Date("2026-11-10T00:00:00Z") };
  const fixture = razorpayFixture(clock, { keyId: "rzp_live_fixture" });
  const review = {
    ...fixture.review,
    mode: "live",
    plans: publishedOffers().map((offer) => ({
      offerId: offer.id,
      reservedCapacityId: null,
      currency: "INR",
      planId: `plan_${offer.id}`,
      totalCount: 12,
    })),
  };
  const env: Record<string, string | undefined> = {
    ...fixture.configuration.env,
    NODE_ENV: "production",
    RAZORPAY_ACCOUNT_REVIEW: JSON.stringify(review),
    SUBSCRIPTION_LIFECYCLE_POLICY: JSON.stringify({
      id: "fixture-lifecycle",
      version: 1,
      mode: "live",
      reviewedBy: "fixture-operator",
      checkedAt: "2026-11-01T00:00:00Z",
      effectiveFrom: "2026-11-01T00:00:00Z",
      effectiveUntil: "2027-11-01T00:00:00Z",
      evidence: ["fixture:cancellation-policy"],
      graceSeconds: 0,
      graceAccess: "none",
      cancellationTiming: "cycle_end",
      cancellationAccess: "paid_through",
      preserveRecords: true,
    }),
    FINANCIAL_ADJUSTMENT_POLICY: JSON.stringify({
      id: "fixture-adjustments",
      version: 1,
      mode: "live",
      account: "acc_fixture:live",
      reviewedBy: "fixture-operator",
      checkedAt: "2026-11-01T00:00:00Z",
      effectiveFrom: "2026-11-01T00:00:00Z",
      effectiveUntil: "2027-11-01T00:00:00Z",
      evidence: ["fixture:refund-policy"],
      normalRefunds: true,
      acceptDisputes: true,
      contestDisputes: true,
      partialRefundAccess: "preserve",
      fullRefundAccess: "block_period",
      disputeOpenAccess: "preserve",
      disputeLostAccess: "block_period",
      disputeWonAccess: "preserve",
      disputeClosedAccess: "preserve",
      disputeLostCredit: true,
      preserveRecords: true,
    }),
    TRIGGER_SECRET_KEY: "tr_prod_fixture",
    TRIGGER_PROJECT_REF: "proj_fixture",
    TRIGGER_PAYMENT_RECOVERY_CRON: "* * * * *",
    TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON: "* * * * *",
    TRIGGER_SELLER_DOCUMENT_RECOVERY_CRON: "* * * * *",
    TRIGGER_FINANCIAL_ADJUSTMENTS_CRON: "* * * * *",
    TRIGGER_PRODUCTION_DEPLOYMENT_VERSION: "fixture-deployment",
    SELLER_DOCUMENT_STORAGE_PROTECTED_CONFIRMED: "true",
  };
  return { fixture, env, review, clock };
}

describe("Production subscription launch boundaries", () => {
  it("rejects unpublished prices, units and markets instead of trusting a selected plan name", () => {
    const offer = publishedOffers()[0];
    expect(publishedOfferMatches(offer, "starter")).toBe(true);
    expect(
      publishedOfferMatches({ ...offer, markets: ["Worldwide"] }, "starter"),
    ).toBe(false);
    expect(
      publishedOfferMatches(
        {
          ...offer,
          prices: {
            ...offer.prices,
            INR: { monthlyMinor: 1, pilotMinor: null },
          },
        },
        "starter",
      ),
    ).toBe(false);
    expect(
      publishedOfferMatches(
        { ...offer, discovery: { quantity: 1200, unit: "unlimited" } },
        "starter",
      ),
    ).toBe(false);
  });
  it("keeps test credentials unavailable in a production deployment without calling the provider", () => {
    const fixture = razorpayFixture({
      now: () => new Date("2026-11-10T00:00:00Z"),
    });
    const gateway = configuredPayments({
      ...fixture.configuration,
      env: { ...fixture.configuration.env, NODE_ENV: "production" },
    });
    expect(gateway.mode).toBe("unconfigured");
    expect(fixture.creations).toEqual([]);
  });
  it("does not accept key presence as evidence of a promoted worker or verified seller", () => {
    const issues = productionSubscriptionIssues({
      SELLER_PUBLIC_PROFILE: "{}",
      TRIGGER_SECRET_KEY: "tr_prod_fixture",
      TRIGGER_PROJECT_REF: "proj_fixture",
      TRIGGER_PAYMENT_RECOVERY_CRON: "* * * * *",
      TRIGGER_TRANSACTIONAL_NOTIFICATION_CRON: "* * * * *",
    });
    expect(issues).toContain("production_workers_required");
    expect(issues).toContain("seller_public_details_required");
    expect(issues).toContain("razorpay_account_review_required");
  });
  it("requires unambiguous native plans, signed webhooks, current policies and protected invoice storage", () => {
    const { env, review, clock } = liveConfiguration();
    expect(productionSubscriptionIssues(env, clock.now())).toEqual([]);
    expect(
      productionSubscriptionIssues(
        {
          ...env,
          RAZORPAY_WEBHOOK_SECRETS: "[]",
          FINANCIAL_ADJUSTMENT_POLICY: "null",
          SELLER_DOCUMENT_STORAGE_PROTECTED_CONFIRMED: "false",
          RAZORPAY_ACCOUNT_REVIEW: JSON.stringify({
            ...review,
            plans: [...review.plans, review.plans[0]],
          }),
        },
        clock.now(),
      ),
    ).toEqual(
      expect.arrayContaining([
        "native_plan_starter_required",
        "signed_payment_webhooks_required",
        "live_refund_dispute_policy_required",
        "protected_invoice_storage_required",
      ]),
    );
    expect(
      productionSubscriptionIssues(env, new Date("2026-10-01T00:00:00Z")),
    ).toEqual(
      expect.arrayContaining([
        "current_razorpay_review_required",
        "live_cancellation_policy_required",
        "live_refund_dispute_policy_required",
      ]),
    );
  });
  it("rejects test-mode financial adjustments in production without provider requests", () => {
    const fixture = razorpayFixture({ now: () => new Date() });
    const gateway = configuredFinancialAdjustments({
      ...fixture.configuration,
      env: { ...fixture.configuration.env, NODE_ENV: "production" },
    });
    expect(gateway.mode).toBe("unconfigured");
    expect(fixture.requests).toEqual([]);
  });
  it("blocks foreign, unpublished, pilot and incompletely configured purchases at the native boundary before I/O", async () => {
    const h = await createHarness();
    try {
      const f = await nativeSubscriptionFixture(h);
      await f.quotes.configure(f.operator, {
        expectedVersion: 1,
        effectiveFrom: null,
        offers: publishedOffers(),
        note: "Synthetic public catalog for India launch regression",
      });
      const quote = await f.quotes.createQuote(f.owner, f.business.id, {
        expectedCatalogVersion: 2,
        expectedBillingVersion: 1,
        expectedReviewVersion: 1,
        offerId: "starter",
        reservedCapacityId: null,
        term: "monthly",
        requestKey: randomUUID(),
      });
      const native = razorpayFixture(h.clock);
      const app = createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
        ),
        gateway: configuredPayments(native.configuration),
        clock: h.clock,
      });
      const action = await app.prepare(f.owner, f.business.id, {
        quoteId: quote.snapshot.id,
        requestKey: randomUUID(),
      });
      const guarded = createSubscriptionPaymentApplication({
        authenticate: h.authenticate,
        authenticatePlatform: h.access.authenticatePlatform,
        repository: createSubscriptionPaymentRepository(
          runtimeDatabase(h.runtime),
          { requireServiceSetup: true },
        ),
        gateway: configuredPayments(native.configuration),
        clock: h.clock,
      });
      await expect(
        guarded.prepare(f.owner, f.business.id, {
          quoteId: quote.snapshot.id,
          requestKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "SETUP_REQUIRED" });
      const workspace = await guarded.workspace(f.owner, f.business.id);
      expect(workspace.gateway.ready).toBe(false);
      expect(workspace.gateway.reasons).toContain(
        "discovery_service_setup_required",
      );
      const outsider = await h.signIn("outside-india-release@example.com");
      await expect(
        guarded.workspace(outsider, f.business.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      // Provision only this disposable database with explicit synthetic service terms.
      await h.application.saveConfiguration(f.owner, f.business.id, {
        offering: "Steel",
        homeMarket: "India",
        homeMarketConfirmed: true,
        buyersReviewed: true,
        specifications: "",
        minimumOrder: "",
        deliveryConstraints: "",
        serviceConstraints: "",
        address: {
          street: "",
          locality: "Pune",
          region: "Maharashtra",
          postalCode: "411001",
          country: "IN",
        },
        additionalMarkets: [],
        buyerCategories: [
          {
            label: "Fabricators",
            identity: "organization",
            use: "business_end_user",
            requiresBuyingRequest: false,
          },
        ],
        exclusions: [],
      });
      const profileId = randomUUID();
      const aiProfile = aiProfileSchema.parse({
        name: "Synthetic India launch profile",
        configurationRevision: "fixture",
        providers: ["openai"],
        extraction: { model: "openai/fixture", schema: "discovery-review-v1" },
        drafting: { model: "openai/fixture", schema: "sales-draft-v1" },
        limits: {
          maxInputChars: 1000,
          maxOutputTokens: 100,
          maxAttempts: 1,
          maxFallbackAttempts: 0,
          deadlineMs: 1000,
          allowanceAttempts: 100,
          fallbackAllowanceAttempts: 0,
        },
      });
      await h.admin.query(
        "insert into ai_profile(id,version,profile,actor_id,at,note) values($1,1,$2,$3,$4,'Synthetic India launch fixture')",
        [
          profileId,
          aiProfile,
          (await h.authenticate(f.operator)).userId,
          h.clock.now(),
        ],
      );
      await h.admin.query(
        "insert into ai_activation(id,version,profile_id) values($1,1,$2)",
        [randomUUID(), profileId],
      );
      await h.admin.query(
        "insert into discovery_configuration(business_id,policy) values($1,$2)",
        [
          f.business.id,
          {
            adapterId: "synthetic-exa",
            activeMarkets: ["India"],
            coverage: [{ market: "India", source: "public_web" }],
            allowanceUnit: "discovery credits",
            maxRunBudget: 100,
            searchUnits: 8,
            reviewUnits: 1,
            concurrency: 1,
            maxResults: 3,
            deadlineMs: 10000,
            exa: { ...exaPolicy, publicOfferings: ["Steel"] },
            permissions: {
              retainEvidence: true,
              retainQueries: false,
              displayEvidence: true,
              exportEvidence: true,
              afterCancellation: true,
              privateAiContext: true,
            },
          },
        ],
      );
      expect(
        (await guarded.workspace(f.owner, f.business.id)).gateway.ready,
      ).toBe(true);
      await expect(
        guarded.prepare(f.owner, f.business.id, {
          quoteId: quote.snapshot.id,
          requestKey: randomUUID(),
        }),
      ).resolves.toMatchObject({ businessId: f.business.id });
      const { fixture, env, clock } = liveConfiguration();
      const gateway = configuredPayments({
        ...fixture.configuration,
        env,
        clock,
      });
      if (gateway.mode !== "live" || !gateway.review)
        throw new Error("Synthetic live gateway configuration is invalid");
      const snapshot: PaymentSnapshot = {
        ...action.snapshot,
        provider: {
          key: gateway.key,
          account: gateway.account,
          mode: gateway.mode,
          review: gateway.review,
        },
      };
      expect(gateway.reviewSnapshot?.(snapshot)).toEqual([]);
      const foreign = (country: string, currency: "INR" | "USD") => ({
        ...snapshot,
        quote: {
          ...snapshot.quote,
          currency,
          profile: {
            ...snapshot.quote.profile,
            profile: {
              ...snapshot.quote.profile.profile,
              address: { ...snapshot.quote.profile.profile.address, country },
            },
          },
        },
      });
      for (const rejected of [
        foreign("US", "USD"),
        foreign("US", "INR"),
        foreign("IN", "USD"),
        foreign("GB", "INR"),
        foreign("", "INR"),
      ]) {
        expect(gateway.reviewSnapshot?.(rejected)).toContain(
          "india_only_checkout",
        );
        await expect(
          gateway.create({
            operationKey: randomUUID(),
            actionId: randomUUID(),
            businessId: f.business.id,
            snapshot: rejected,
          }),
        ).rejects.toBeInstanceOf(PaymentCreationNotAttempted);
      }
      for (const rejected of [
        { ...snapshot, term: { kind: "days", days: 14, timeZone: "UTC" } },
        {
          ...snapshot,
          quote: {
            ...snapshot.quote,
            pricing: {
              ...snapshot.quote.pricing,
              offer: {
                ...snapshot.quote.pricing.offer,
                markets: ["Worldwide"],
              },
            },
          },
        },
      ] satisfies PaymentSnapshot[]) {
        expect(gateway.reviewSnapshot?.(rejected)).toContain(
          "published_india_plan_required",
        );
        await expect(
          gateway.create({
            operationKey: randomUUID(),
            actionId: randomUUID(),
            businessId: f.business.id,
            snapshot: rejected,
          }),
        ).rejects.toBeInstanceOf(PaymentCreationNotAttempted);
      }
      const closed = configuredPayments({
        ...fixture.configuration,
        env: { ...env, TRIGGER_PRODUCTION_DEPLOYMENT_VERSION: undefined },
        clock,
      });
      expect(closed.reviewSnapshot?.(snapshot)).toContain(
        "production_workers_required",
      );
      await expect(
        closed.create({
          operationKey: randomUUID(),
          actionId: randomUUID(),
          businessId: f.business.id,
          snapshot,
        }),
      ).rejects.toBeInstanceOf(PaymentCreationNotAttempted);
      const body = new TextEncoder().encode(
        JSON.stringify({
          account_id: fixture.review.account,
          event: "subscription.charged",
          payload: {
            subscription: {
              entity: {
                id: "sub_existing",
                status: "active",
                notes: { operation_key: action.operationKey },
              },
            },
          },
        }),
      );
      const observed = await closed.authenticateEvent({
        body,
        headers: new Headers({
          "x-razorpay-event-id": "evt_existing",
          "x-razorpay-signature": createHmac("sha256", "fixture-webhook-secret")
            .update(body)
            .digest("hex"),
        }),
      });
      expect(observed.observation.operationKey).toBe(action.operationKey);
      expect(observed.observation.status).toBe("unknown");
      expect(fixture.requests).toEqual([]);
      expect(fixture.creations).toEqual([]);
    } finally {
      await h.close();
    }
  });
});
