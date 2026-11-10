import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BusinessPageHeader } from "@/components/business-page-header";
import { PlanBilling } from "@/components/plan-billing";
export const dynamic = "force-dynamic";
export const metadata = { title: "Plan and usage" };
export default async function Page({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).subscriptionPayments.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="plan"></BusinessPageHeader>
      <PlanBilling businessId={businessId} initial={state} />
    </div>
  );
}
