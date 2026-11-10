import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CostManager } from "@/components/cost-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Operator costs and budgets" };
export default async function OperatorCosts({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month =
    (await searchParams).month ?? new Date().toISOString().slice(0, 7);
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).costs.workspace(await headers(), month);
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Operator costs and budgets</>}
        description={
          <>
            Review attributable usage, commitments, gaps and responsible
            notifications.
          </>
        }
      ></PageHeader>
      <CostManager initial={initial} />
    </div>
  );
}
