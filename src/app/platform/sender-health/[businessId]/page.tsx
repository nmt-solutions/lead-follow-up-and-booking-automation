import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderHealthManager } from "@/components/sender-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Review sender health" };
export default async function ReviewPage({
  params,
}: PageProps<"/platform/sender-health/[businessId]">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).senderHealth.workspace(await headers(), businessId, true);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Review sender health</>}
        description={
          <>
            Business {businessId}. Your current sender-health capability and
            recent authenticator verification are required for every operation.
          </>
        }
      ></PageHeader>
      <SenderHealthManager state={state} operator />
    </div>
  );
}
