import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BusinessReportPanel } from "@/components/business-report-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports" };
export default async function ReportsPage({
  params,
}: PageProps<"/businesses/[businessId]/reports">) {
  const { businessId } = await params;
  const report = await (async () => {
    try {
      return await (
        await getServices()
      ).reporting.read(await headers(), businessId, {});
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Reports</>}
        description={
          <>
            Review sourced prospects, recorded conversations and confirmed
            outcomes. Every measure names its evidence and population.
          </>
        }
      ></PageHeader>
      <BusinessReportPanel businessId={businessId} initialReport={report} />
    </div>
  );
}
