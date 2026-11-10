import { describe, expect, it } from "vitest";
import type { BusinessProfile } from "../src/models/business";
import { billingDefaults } from "../src/models/billing-defaults";

const business: Pick<BusinessProfile, "name" | "configuration"> = {
  name: "Example business",
  configuration: {
    specifications: "",
    minimumOrder: "",
    deliveryConstraints: "",
    serviceConstraints: "",
    address: {
      street: "12 Market Road",
      locality: "Pune",
      region: "Maharashtra",
      postalCode: "411001",
      country: "India",
    },
    additionalMarkets: [],
    buyerCategories: [
      {
        label: "Online stores",
        identity: "organization",
        use: "business_end_user",
        requiresBuyingRequest: false,
      },
    ],
    exclusions: [],
    homeMarketConfirmedAt: "2026-11-10T10:00:00Z",
    buyersReviewedAt: "2026-11-10T10:00:00Z",
  },
};
const user = {
  name: "Example owner",
  email: "owner@example.com",
  accountType: "company",
};

describe("Billing details reused from business setup", () => {
  it("prefills the saved business address and invoice contact without asserting consent or tax treatment", () => {
    const defaults = billingDefaults(undefined, business, user);
    expect(defaults).toMatchObject({
      legalName: business.name,
      invoiceContact: { name: user.name, email: user.email },
      address: {
        line1: "12 Market Road",
        line2: "",
        city: "Pune",
        region: "Maharashtra",
        postalCode: "411001",
        country: "IN",
      },
    });
    expect(defaults.declaration).toBeUndefined();
    expect(defaults.indiaTaxTreatment).toBeUndefined();
  });
  it("keeps a separately saved billing address and tax information instead of replacing them with business defaults", () => {
    const saved = billingDefaults(undefined, business, user);
    saved.legalName = "Separate legal name";
    saved.address.city = "Mumbai";
    saved.taxIdentifierStatus = "provided";
    saved.taxIdentifiers = [
      { kind: "GSTIN", country: "IN", value: "test-existing-tax-record" },
    ];
    expect(
      billingDefaults(saved, business, { ...user, email: "new@example.com" }),
    ).toEqual(saved);
    expect(saved.address.city).toBe("Mumbai");
    expect(saved.invoiceContact.email).toBe("owner@example.com");
  });
});
