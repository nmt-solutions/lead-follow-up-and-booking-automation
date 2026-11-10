import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { RecoveryPanel } from "@/components/recovery-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Infrastructure recovery" };
export default async function RecoveryPage() {
  const { state, canReconcileCosts } = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const canReconcileCosts = await services.team
        .requirePlatformCapability(credentials, "costs.manage")
        .then(
          () => true,
          () => false,
        );
      const state = await services.recovery.workspace(credentials);
      return { state, canReconcileCosts };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<>Infrastructure recovery</>}
        description={
          <>
            Restore and inspect a reviewed Business snapshot in a private
            disposable environment. Track verified records, file coverage and
            unresolved work.
          </>
        }
      ></PageHeader>
      <RecoveryPanel state={state} canReconcileCosts={canReconcileCosts} />
    </div>
  );
}
