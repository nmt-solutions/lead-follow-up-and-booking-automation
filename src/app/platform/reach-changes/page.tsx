import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ReachChangeManager } from "@/components/reach-change-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reach change recovery" };
export default async function ReachChangeQueue() {
  const state = await (async () => {
    try {
      return await (await getServices()).reachChanges.queue(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Reach change recovery</>}
        description={
          <>
            Reconcile saved Business approvals and exact native references.
            Unknown financial actions stay with their original intent.
          </>
        }
      ></PageHeader>
      <ReachChangeManager initial={state} operator />
    </div>
  );
}
