import { sellerDetails } from "../content/seller";
import { indiaStates } from "../models/india-gst";
import { taxRuleSchema, type TaxRule } from "../models/tax";
import { issuerConfigurationSchema } from "../models/seller-documents";

export const leadRelaySac = "998315";
export const gstSources = {
  classification:
    "https://www.gstcouncil.gov.in/sites/default/files/2024-02/explanatory_notes_01oct19.pdf",
  rates: "https://cbic-gst.gov.in/hindi/gst-goods-services-rates.html",
  placeOfSupply:
    "https://taxinformation.cbic.gov.in/content-page/explore-act/1000620/1000001",
};
const rounding = {
  mode: "half_up",
  scope: "per_line",
  incrementMinor: "1",
} as const;
/** Standard domestic draft only. Publication does not approve taxpayer scheme, SEZ or export treatment. */
export function indiaGstDrafts(at: Date): { key: string; rule: TaxRule }[] {
  return indiaStates.flatMap((state) =>
    (["business", "individual"] as const).map((buyerStatus) => ({
      key: `leadrelay-in-${state.code}-${buyerStatus}-standard-gst`,
      rule: taxRuleSchema.parse({
        mode: "live",
        customerCountry: "IN",
        customerRegion: state.code,
        buyerStatus,
        currency: "INR",
        productCode: "subscription",
        effectiveFrom: at.toISOString(),
        effectiveUntil: null,
        jurisdiction: {
          code: `IN-${state.code}`,
          name: `${state.name} (${state.code})`,
          country: "IN",
        },
        registration: {
          status: "registered",
          identifier: sellerDetails.gstin,
          effectiveFrom: at.toISOString(),
          effectiveUntil: null,
        },
        treatment: "taxable",
        rationale: `Lead Relay is hosted SaaS classified as SAC ${leadRelaySac}; standard regular-taxpayer domestic supply from Maharashtra (27), under IGST Act sections 7, 8 and 12(2). Seller particulars are account-holder supplied. Taxpayer scheme and e-invoice applicability must be resolved before approval; SEZ, exports and special treatment are excluded.`,
        requiredEvidence: [
          "legal_identity",
          "billing_address",
          "business_status",
        ],
        evidenceBasis: "customer_declaration",
        rates:
          state.code === "27"
            ? [
                { name: "CGST", numerator: "9", denominator: "100" },
                { name: "SGST", numerator: "9", denominator: "100" },
              ]
            : [{ name: "IGST", numerator: "18", denominator: "100" }],
        rounding,
        evidence: Object.entries(gstSources).map(([title, reference]) => ({
          title,
          reference,
          checkedAt: at.toISOString(),
        })),
      }),
    })),
  );
}
export function indiaIssuerDraft(at: Date) {
  const indiaDate = new Date(at.getTime() + 330 * 60 * 1000);
  const startYear =
    indiaDate.getUTCMonth() >= 3
      ? indiaDate.getUTCFullYear()
      : indiaDate.getUTCFullYear() - 1;
  const suffix = `${String(startYear).slice(-2)}${String(startYear + 1).slice(-2)}`;
  const fiscalEnd = new Date(Date.UTC(startYear + 1, 2, 31, 18, 30));
  return issuerConfigurationSchema.parse({
    mode: "live",
    effectiveFrom: at.toISOString(),
    effectiveUntil: fiscalEnd.toISOString(),
    seller: {
      legalName: sellerDetails.legalName,
      address: sellerDetails.address,
      country: "IN",
      contact: `${sellerDetails.supportEmail} · ${sellerDetails.phone}`,
    },
    legalFields: [
      { label: "CIN", value: sellerDetails.cin },
      { label: "GSTIN", value: sellerDetails.gstin },
      { label: "SAC", value: leadRelaySac },
      { label: "Supplier state", value: "Maharashtra (27)" },
      { label: "Service", value: "Lead Relay hosted SaaS subscription" },
      { label: "Reverse charge", value: "No — standard domestic supply" },
    ],
    requiredCustomerFields: ["legalName", "address", "invoiceContact"],
    series: {
      invoice: {
        key: `leadrelay-invoice-${startYear}-${startYear + 1}`,
        prefix: `LR${suffix}-`,
        first: "1",
        width: 6,
      },
      credit_note: {
        key: `leadrelay-credit-${startYear}-${startYear + 1}`,
        prefix: `LC${suffix}-`,
        first: "1",
        width: 6,
      },
    },
    currencies: [
      { currency: "INR", precision: 2, rounding, additionalRoundings: [] },
    ],
    template: {
      format: "text_v1",
      invoiceTitle: "Tax Invoice",
      creditTitle: "Credit Note",
      footer: `Lead Relay · ${sellerDetails.supportEmail} · ${sellerDetails.phone}`,
    },
    retention: {
      minimumSeconds: 9 * 366 * 86400,
      policyReference:
        "Protected financial history: minimum covers eight financial years; longer statutory extensions, disputes and legal holds take precedence. No automatic erasure of protected invoices.",
      disposition: "protected_history",
    },
    creditAllocation: "cumulative_original_components_v1",
    evidence: [
      {
        title: "Seller particulars",
        reference:
          "Account-holder supplied registered company, GSTIN, address and designated grievance officer on 10 November 2026; portal registration status not independently verified.",
        checkedAt: at.toISOString(),
      },
      {
        title: "Invoice basis",
        reference:
          "Standard domestic SaaS draft. Confirm regular taxpayer scheme and e-invoice applicability before approval. Current financial-year product series; preserve all issued numbering and artifacts.",
        checkedAt: at.toISOString(),
      },
    ],
  });
}
