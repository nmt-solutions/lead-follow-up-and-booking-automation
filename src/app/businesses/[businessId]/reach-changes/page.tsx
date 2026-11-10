import { PageHeader } from "@/components/page-header";

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
    <div className="app-page">
      <PageHeader
        title={<>Change geographic reach</>}
        description={
          <>
            Review the exact prorated payment and monthly renewal before
            approving. Reductions begin with a paid eligible renewal. Stored
            prospects and incoming or engaged conversations remain available.
          </>
        }
      ></PageHeader>
      <ReachChangeManager
        businessId={businessId}
        initial={data.state}
        periodId={data.payments.access.period?.id ?? null}
        quotes={data.quotes.quotes}
      />
    </div>
  );
}
