import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ReachChangeManager } from "@/components/reach-change-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Change geographic reach" };
export default async function ReachChangesPage({
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
        state: await s.reachChanges.workspace(c, businessId),
        payments: await s.subscriptionPayments.workspace(c, businessId),
        quotes: await s.subscriptionQuotes.workspace(c, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}/subscription-payments`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Subscription payments
        </Link>
        <h1 className="page-title">Change geographic reach</h1>
        <p className="mt-3 text-muted-foreground">
          Review the exact prorated payment and monthly renewal before
          approving. Reductions begin with a paid eligible renewal. Stored
          prospects and incoming or engaged conversations remain available.
        </p>
      </header>
      <ReachChangeManager
        businessId={businessId}
        initial={data.state}
        periodId={data.payments.access.period?.id ?? null}
        quotes={data.quotes.quotes}
      />
    </div>
  );
}
