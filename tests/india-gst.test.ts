import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sellerDetails } from "../src/content/seller";
import { sellerPublicProfile } from "../src/production/subscriptions";
import { indiaGstDrafts, indiaIssuerDraft } from "../src/production/india-gst";
import {
  indiaStates,
  indiaStateCode,
  validGstin,
} from "../src/models/india-gst";
import {
  billingConfirmSchema,
  billingState,
  declarationReviewNote,
  type BillingRevision,
} from "../src/models/billing";
import { evaluateTax } from "../src/application/tax-calculation";
import type { TaxCatalog } from "../src/models/tax";

const at = new Date("2026-11-10T12:00:00.000Z");
function billing(
  region = "Maharashtra",
  buyerStatus: "business" | "individual" = "business",
) {
  const revision: BillingRevision = {
    id: randomUUID(),
    businessId: randomUUID(),
    version: 1,
    at: at.toISOString(),
    actorId: "fixture-owner",
    actorName: "Fixture Owner",
    note: declarationReviewNote,
    evidence: [],
    profile: {
      legalName: "Fixture buyer",
      registrationNumber: "",
      address: {
        line1: "1 Example Road",
        line2: "",
        city: "Example City",
        region,
        postalCode: "411001",
        country: "IN",
      },
      invoiceContact: { name: "Fixture Owner", email: "owner@example.com" },
      businessStatus: buyerStatus,
      taxIdentifierStatus: "not_applicable",
      taxIdentifiers: [],
      evidence: [],
      indiaTaxTreatment: "standard",
      declaration: {
        version: "2026-11-10",
        actorId: "fixture-owner",
        at: at.toISOString(),
        acceptedTerms: true,
      },
    },
  };
  return billingState(
    [revision],
    [
      {
        id: randomUUID(),
        businessId: revision.businessId,
        profileId: revision.id,
        profileVersion: 1,
        version: 1,
        outcome: "reviewed",
        findings: [],
        note: declarationReviewNote,
        actorId: revision.actorId,
        actorName: revision.actorName,
        at: revision.at,
      },
    ],
  );
}
function fixtureApprovedCatalog(): TaxCatalog {
  const revisions = indiaGstDrafts(at).map((draft) => ({
    ...draft,
    id: randomUUID(),
    version: 1,
    actorId: "fixture-operator",
    actorName: "Fixture Operator",
    at: at.toISOString(),
    note: "Synthetic approval for arithmetic tests only",
  }));
  return {
    revisions,
    decisions: revisions.map((revision) => ({
      id: randomUUID(),
      revisionId: revision.id,
      version: 1,
      outcome: "approved",
      actorId: "fixture-operator",
      actorName: "Fixture Operator",
      at: at.toISOString(),
      note: "Test fixture; no production legal approval",
    })),
  };
}
function calculate(
  region: string,
  amount: number,
  buyerStatus: "business" | "individual" = "business",
  catalog = fixtureApprovedCatalog(),
) {
  return evaluateTax(
    {
      requestKey: randomUUID(),
      expectedProfileVersion: 1,
      expectedReviewVersion: 1,
      currency: "INR",
      lines: [
        {
          id: "subscription",
          productCode: "subscription",
          description: "Fixture subscription",
          unitAmountMinor: String(amount),
          quantity: 1,
        },
      ],
      note: "Arithmetic fixture",
    },
    billing(region, buyerStatus),
    catalog,
    at,
    "live",
  );
}
describe("Lead Relay domestic GST", () => {
  it("uses the supplied seller and grievance particulars and fails closed on an invalid explicit override", () => {
    expect(sellerPublicProfile({})).toEqual(sellerDetails);
    expect(sellerPublicProfile({ SELLER_PUBLIC_PROFILE: "{}" })).toBeNull();
    expect(validGstin(sellerDetails.gstin)).toBe(true);
    expect(validGstin("27AAKCN1287D1ZA")).toBe(false);
  });
  it("normalizes state names, codes and common abbreviations without treating unknown places as Maharashtra", () => {
    for (const value of ["Maharashtra", "maharashtra", "MH", "IN-MH", "27"])
      expect(indiaStateCode(value)).toBe("27");
    expect(indiaStateCode("KA")).toBe("29");
    expect(indiaStateCode("Odisha")).toBe("21");
    expect(indiaStateCode("Orissa")).toBe("21");
    expect(indiaStateCode("Other Territory")).toBeNull();
    expect(indiaStateCode("Pune")).toBeNull();
  });
  it("calculates each published price for every supported state and buyer class with one unambiguous GST treatment", () => {
    const catalog = fixtureApprovedCatalog();
    for (const state of indiaStates)
      for (const buyer of ["business", "individual"] as const)
        for (const amount of [199900, 499900, 999900]) {
          const result = calculate(state.name, amount, buyer, catalog);
          expect(result.status).toBe("calculated");
          expect(result.totals).toEqual({
            netMinor: String(amount),
            taxMinor: String((amount * 18) / 100),
            totalMinor: String((amount * 118) / 100),
          });
          expect(result.lines[0].components.map((part) => part.name)).toEqual(
            state.code === "27" ? ["CGST", "SGST"] : ["IGST"],
          );
        }
    expect(calculate("IN-MH", 199900).status).toBe("calculated");
    expect(calculate("Pune", 199900).status).toBe("review_required");
  });
  it("does not activate prepared drafts or accept SEZ, invalid GSTINs or a GSTIN from a different state", () => {
    const catalog = fixtureApprovedCatalog();
    expect(
      calculate("Maharashtra", 199900, "business", {
        ...catalog,
        decisions: [],
      }).status,
    ).toBe("review_required");
    const { declaration, evidence, ...facts } = billing().current!.profile;
    void declaration;
    void evidence;
    const input = {
      expectedVersion: 0,
      expectedReviewVersion: 0,
      acceptedTerms: true,
      profile: facts,
    };
    expect(billingConfirmSchema.safeParse(input).success).toBe(true);
    expect(
      billingConfirmSchema.safeParse({
        ...input,
        profile: { ...facts, indiaTaxTreatment: "needs_review" },
      }).success,
    ).toBe(false);
    expect(
      billingConfirmSchema.safeParse({
        ...input,
        profile: {
          ...facts,
          address: { ...facts.address, region: "Karnataka" },
          taxIdentifierStatus: "provided",
          taxIdentifiers: [
            { kind: "GSTIN", country: "IN", value: sellerDetails.gstin },
          ],
        },
      }).success,
    ).toBe(false);
  });
  it("sets distinct financial-year invoice and credit-note series and expires them at the India-year boundary", () => {
    const issuer = indiaIssuerDraft(at);
    expect(issuer.series.invoice.prefix).toBe("LR2627-");
    expect(issuer.series.credit_note.prefix).toBe("LC2627-");
    expect(
      issuer.series.invoice.prefix.length + issuer.series.invoice.width,
    ).toBeLessThanOrEqual(16);
    expect(issuer.effectiveUntil).toBe("2027-03-31T18:30:00.000Z");
    expect(
      indiaIssuerDraft(new Date("2027-03-31T18:30:00.000Z")).series.invoice
        .prefix,
    ).toBe("LR2728-");
  });
});
