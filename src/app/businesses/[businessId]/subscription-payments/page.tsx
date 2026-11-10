import { BusinessPageHeader } from "@/components/business-page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionPaymentManager } from "@/components/subscription-payment-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Payment history" };
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
      <BusinessPageHeader section="subscription-payments">
        <Link
          href={`/businesses/${businessId}/reach-changes`}
          className="mt-3 mr-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Review search areas
        </Link>
        <Link
          href={`/businesses/${businessId}/seller-documents`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Invoices and credit notes
        </Link>
      </BusinessPageHeader>
      <SubscriptionPaymentManager
        businessId={businessId}
        initial={data.state}
        quotes={data.quotes.quotes}
      />
    </div>
  );
}
