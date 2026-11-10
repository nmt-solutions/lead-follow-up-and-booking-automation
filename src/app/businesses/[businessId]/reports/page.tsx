import Link from "next/link";
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
    <div className="space-y-8">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}`}
        >
          Back to overview
        </Link>
        <h1 className="page-title">Reports</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Review sourced prospects, recorded conversations and confirmed
          outcomes. Every measure names its evidence and population.
        </p>
      </header>
      <BusinessReportPanel businessId={businessId} initialReport={report} />
    </div>
  );
}
