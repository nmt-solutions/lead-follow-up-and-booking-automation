import { describe, expect, it } from "vitest";
import { publishedOffers } from "../src/content/plans";
import {
  productionSubscriptionIssues,
  publishedOfferMatches,
} from "../src/production/subscriptions";
import { configuredPayments } from "../src/subscription-payments/configuration";
import { razorpayFixture } from "./support/razorpay";

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
});
