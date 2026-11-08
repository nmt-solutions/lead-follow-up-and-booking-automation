import type { createSellerDocumentApplication } from "../../src/application/seller-documents";
export async function approveFixtureIssuer(
  documents: ReturnType<typeof createSellerDocumentApplication<Headers>>,
  op: Headers,
) {
  const catalog = await documents.saveIssuer(op, {
    expectedVersion: 0,
    note: "Fixture legal approval",
    configuration: {
      mode: "fixture",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveUntil: null,
      seller: {
        legalName: "Synthetic seller",
        address: "Fixture address",
        country: "IN",
        contact: "seller@example.com",
      },
      legalFields: [{ label: "Registration", value: "TEST-ONLY" }],
      requiredCustomerFields: ["legalName", "address", "invoiceContact"],
      series: {
        invoice: {
          key: "export-invoice",
          prefix: "EXP-I-",
          first: "1",
          width: 4,
        },
        credit_note: {
          key: "export-credit",
          prefix: "EXP-C-",
          first: "1",
          width: 4,
        },
      },
      currencies: [
        {
          currency: "INR",
          precision: 2,
          rounding: { mode: "half_up", scope: "per_line", incrementMinor: "1" },
          additionalRoundings: [],
        },
      ],
      template: {
        format: "text_v1",
        invoiceTitle: "Seller invoice",
        creditTitle: "Credit note",
        footer: "Fixture only",
      },
      retention: {
        minimumSeconds: 86400,
        policyReference: "fixture protected financial history",
        disposition: "protected_history",
      },
      creditAllocation: "cumulative_original_components_v1",
      evidence: [
        {
          title: "Fixture legal review",
          reference: "fixture legal record",
          checkedAt: "2026-11-01T00:00:00Z",
        },
      ],
    },
  });
  await documents.decideIssuer(op, {
    revisionId: catalog.revisions[0].id,
    expectedVersion: 0,
    outcome: "approved",
    note: "Fixture exact approval",
  });
}
