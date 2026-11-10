import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionQuoteManager } from "@/components/subscription-quote-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Plan quotes" };
export default async function SubscriptionQuotesPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        state: await services.subscriptionQuotes.workspace(
          credentials,
          businessId,
        ),
        profile: await services.application.getProfile(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="subscription-quotes"></BusinessPageHeader>
      <SubscriptionQuoteManager businessId={businessId} initial={data.state} />
    </div>
  );
}
