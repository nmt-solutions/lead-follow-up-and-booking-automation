import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { PageHeader } from "@/components/page-header";
import { PlanBilling } from "@/components/plan-billing";
export const dynamic = "force-dynamic";
export const metadata = { title: "Plan & billing" };
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
      <PageHeader
        title="Plan & billing"
        description="Your subscription, monthly allowance and payment controls."
      />
      <PlanBilling businessId={businessId} initial={state} />
    </div>
  );
}
