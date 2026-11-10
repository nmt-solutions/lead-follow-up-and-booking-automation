import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OperationsPanel } from "@/components/operations-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Platform operations" };
export default async function PlatformOperationsPage() {
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).operations.workspace(await headers(), null, true);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={<>Platform operations</>}
        description={
          <>
            Inspect runs, queues and channel health. Maintenance keeps each
            Business’s authorization, ownership and limits.
          </>
        }
      ></PageHeader>
      <OperationsPanel initialState={state} />
    </div>
  );
}
