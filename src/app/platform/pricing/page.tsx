import Link from "next/link";
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Subscription pricing</h1>
        <p className="mt-3 text-muted-foreground">
          Configure versioned reach, allowances and optional capacity for
          Business subscription quotes. A separately provisioned pricing
          operator grant and fresh MFA are required.
        </p>
      </header>
      <SubscriptionPricingManager initial={state} />
    </div>
  );
}
