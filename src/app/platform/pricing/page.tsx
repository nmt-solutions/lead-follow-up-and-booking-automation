import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionPricingManager } from "@/components/subscription-pricing-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription pricing" };
export default async function SubscriptionPricingPage() {
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).subscriptionQuotes.catalog(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Subscription pricing</>}
        description={
          <>
            Configure versioned reach, allowances and optional capacity for
            Business subscription quotes. A separately provisioned pricing
            operator grant and fresh MFA are required.
          </>
        }
      ></PageHeader>
      <SubscriptionPricingManager initial={state} />
    </div>
  );
}
