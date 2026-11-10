import "server-only";
import { cookies, headers } from "next/headers";
import { getServices } from "./services";
import { billingDefaults } from "../models/billing-defaults";
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
  const defaults = billingDefaults(
    quotes.billing.current?.profile,
    profile,
    identity.user,
  );
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
