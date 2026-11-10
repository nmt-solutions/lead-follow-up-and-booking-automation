import type { BillingProfile } from "./billing";
import type { BusinessProfile } from "./business";

export function billingDefaults(
  saved: BillingProfile | undefined,
  business: Pick<BusinessProfile, "name" | "configuration">,
  user: { name: string; email: string; accountType?: string | null },
): BillingProfile {
  if (saved) return saved;
  const address = business.configuration?.address;
  const country = address?.country.trim() ?? "";
  return {
    legalName: business.name,
    registrationNumber: "",
    address: {
      line1: address?.street.slice(0, 300) ?? "",
      line2: address?.street.slice(300) ?? "",
      city: address?.locality ?? "",
      region: address?.region ?? "",
      postalCode: address?.postalCode ?? "",
      country:
        !country || /^(in|india)$/i.test(country)
          ? "IN"
          : country.length === 2
            ? country.toUpperCase()
            : "",
    },
    invoiceContact: { name: user.name, email: user.email },
    businessStatus: user.accountType === "personal" ? "individual" : "business",
    taxIdentifierStatus: "not_applicable",
    taxIdentifiers: [],
    evidence: [],
  };
}
