import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxManager } from "@/components/tax-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tax details" };
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
      <BusinessPageHeader section="tax"></BusinessPageHeader>
      <TaxManager businessId={businessId} initial={state} />
    </div>
  );
}
