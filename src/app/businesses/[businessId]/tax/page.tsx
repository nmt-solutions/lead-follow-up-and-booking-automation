import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxManager } from "@/components/tax-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription tax preview" };
export default async function TaxPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).tax.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Subscription tax preview</>}
        description={
          <>
            See a calculated total or the reasons an operator review is
            required. Each request preserves its original evidence and
            treatment.
          </>
        }
      ></PageHeader>
      <TaxManager businessId={businessId} initial={state} />
    </div>
  );
}
