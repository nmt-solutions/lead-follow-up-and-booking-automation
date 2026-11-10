import "server-only";
import { cookies, headers } from "next/headers";
import { getServices } from "./services";
import type { BillingProfile } from "../models/billing";
import { isPlanId } from "../content/plans";
import {
  productionSubscriptionIssues,
  publishedOfferMatches,
} from "../production/subscriptions";

export async function subscriptionSetupData(
  businessId: string,
  selection?: string,
) {
  const services = await getServices();
  const credentials = await headers();
  const [quotes, payments, profile, identity] = await Promise.all([
    services.subscriptionQuotes.workspace(credentials, businessId),
    services.subscriptionPayments.workspace(credentials, businessId),
    services.application.getProfile(credentials, businessId),
    services.access.primary(credentials),
  ]);
  const remembered = (await cookies()).get("lr_plan")?.value;
  const selected =
    selection === "choose"
      ? undefined
      : isPlanId(selection)
        ? selection
        : isPlanId(remembered)
          ? remembered
          : undefined;
  const address = profile.configuration?.address;
  const country = address?.country.trim() ?? "";
  const defaults: BillingProfile = quotes.billing.current?.profile ?? {
    legalName: profile.name,
    registrationNumber: "",
    address: {
      line1: address?.street ?? "",
      line2: "",
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
    invoiceContact: { name: identity.user.name, email: identity.user.email },
    businessStatus:
      identity.user.accountType === "personal" ? "individual" : "business",
    taxIdentifierStatus: "not_applicable",
    taxIdentifiers: [],
    evidence: [],
  };
  return {
    businessId,
    selected,
    defaults,
    initial: quotes.billing,
    available:
      productionSubscriptionIssues().length === 0 &&
      payments.gateway.ready &&
      defaults.address.country === "IN" &&
      Boolean(
        selected &&
        quotes.offers.some(
          (offer) =>
            offer.id === selected && publishedOfferMatches(offer, selected),
        ),
      ),
    existing:
      payments.access.active ||
      payments.actions.some(
        (action) =>
          action.started &&
          action.state !== "failed" &&
          action.lifecycle?.state !== "cancelled",
      ),
  };
}
