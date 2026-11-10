import { PageHeader } from "@/components/page-header";
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
    <div className="app-page">
      <PageHeader
        title={<>Subscription payments</>}
        description={
          <>
            Review the exact tax, total and intended period before hosted
            checkout. Paid access starts after provider confirmation.
          </>
        }
      >
        <Link
          href={`/businesses/${businessId}/reach-changes`}
          className="mt-3 mr-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Change geographic reach
        </Link>
        <Link
          href={`/businesses/${businessId}/seller-documents`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          View invoices and credit notes
        </Link>
      </PageHeader>
      <SubscriptionPaymentManager
        businessId={businessId}
        initial={data.state}
        quotes={data.quotes.quotes}
      />
    </div>
  );
}
