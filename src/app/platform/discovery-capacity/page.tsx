import { PageHeader } from "@/components/page-header";
import { headers } from "next/headers";

import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { DiscoveryCapacityManager } from "@/components/discovery-capacity-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Discovery capacity" };
export default async function DiscoveryCapacityPage() {
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).discoveryCapacity.configuration(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Discovery capacity</>}
        description={
          <>
            Approve finite provider capacity and allocate purchased
            reservations. Deployment and current paid contracts are required
            before execution.
          </>
        }
      ></PageHeader>
      <DiscoveryCapacityManager initial={initial} />
    </div>
  );
}
