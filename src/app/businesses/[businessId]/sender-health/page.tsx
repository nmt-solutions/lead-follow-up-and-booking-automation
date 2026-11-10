import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderHealthManager } from "@/components/sender-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Email delivery" };
export default async function SenderHealthPage({
  params,
}: PageProps<"/businesses/[businessId]/sender-health">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).senderHealth.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="sender-health"></BusinessPageHeader>
      <SenderHealthManager state={state} />
    </div>
  );
}
