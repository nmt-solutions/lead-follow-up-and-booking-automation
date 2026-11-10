import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { FinancialAdjustmentManager } from "@/components/financial-adjustment-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Refunds and disputes" };
export default async function FinancialWorkspace({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).financialAdjustments.workspace(await headers(), businessId, true);
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader title={<>Refunds and disputes</>}></PageHeader>
      <FinancialAdjustmentManager
        businessId={businessId}
        initial={initial}
        operator={true}
      />
    </div>
  );
}
