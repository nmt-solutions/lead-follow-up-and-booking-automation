export const fixtureIssuer = {
  mode: "fixture",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveUntil: null,
  seller: {
    legalName: "Synthetic seller",
    address: "Fixture address",
    country: "IN",
    contact: "seller@example.com",
  },
  legalFields: [{ label: "Synthetic registration", value: "TEST-ONLY" }],
  requiredCustomerFields: ["legalName", "address", "invoiceContact"],
  series: {
    invoice: {
      key: "fixture-invoices",
      prefix: "TEST-I-",
      first: "1",
      width: 4,
    },
    credit_note: {
      key: "fixture-credits",
      prefix: "TEST-C-",
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
    footer: "Synthetic fixture only",
  },
  retention: {
    minimumSeconds: 86400,
    policyReference: "fixture:protected-history",
    disposition: "protected_history",
  },
  creditAllocation: "cumulative_original_components_v1",
  evidence: [
    {
      title: "Fixture legal review",
      reference: "fixture:issuer-review",
      checkedAt: "2026-11-05T08:00:00.000Z",
    },
  ],
};
