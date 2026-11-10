import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BusinessDataPanel } from "@/components/business-data-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Export or remove data" };
export default async function BusinessDataPage({
  params,
}: PageProps<"/businesses/[businessId]/data">) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const s = await getServices(),
        c = await headers();
      return {
        state: await s.dataGovernance.workspace(c, businessId),
        payments: await s.subscriptionPayments.workspace(c, businessId),
      };
    } catch (e) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Export or remove data</>}
        description={
          <>Keep agreed records and review each step of stopping the service.</>
        }
      ></PageHeader>
      <BusinessDataPanel
        businessId={businessId}
        initial={data.state}
        cancellations={data.payments.actions.map((a) => ({
          id: a.id,
          status: a.lifecycle?.state ?? a.state,
          timing: a.lifecycle?.policy?.cancellationTiming ?? null,
          access: a.lifecycle?.policy?.cancellationAccess ?? null,
          policy: a.lifecycle?.policy
            ? `${a.lifecycle.policy.id} v${a.lifecycle.policy.version}`
            : null,
        }))}
      />
    </div>
  );
}
