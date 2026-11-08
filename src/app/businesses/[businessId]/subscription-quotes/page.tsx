import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionQuoteManager } from "@/components/subscription-quote-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription quotes" };
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 font-medium text-primary wrap-anywhere">
          {data.profile.name}
        </p>
        <h1 className="page-title">Subscription quotes</h1>
        <p className="mt-3 text-muted-foreground">
          Review the configured reach, automation allowances, capacity and
          monthly renewal price for this Business before any commercial
          checkout.
        </p>
      </header>
      <SubscriptionQuoteManager businessId={businessId} initial={data.state} />
    </div>
  );
}
