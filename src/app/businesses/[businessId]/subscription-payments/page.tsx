import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionPaymentManager } from "@/components/subscription-payment-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription payments" };
export default async function SubscriptionPaymentsPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const s = await getServices(),
        c = await headers();
      return {
        state: await s.subscriptionPayments.workspace(c, businessId),
        quotes: await s.subscriptionQuotes.workspace(c, businessId),
        profile: await s.application.getProfile(c, businessId),
      };
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 font-medium text-primary wrap-anywhere">
          {data.profile.name}
        </p>
        <h1 className="page-title">Subscription payments</h1>
        <p className="mt-3 text-muted-foreground">
          Review the exact tax, total and intended period before hosted
          checkout. Paid access starts after provider confirmation.
        </p>
      </header>
      <SubscriptionPaymentManager
        businessId={businessId}
        initial={data.state}
        quotes={data.quotes.quotes}
      />
    </div>
  );
}
