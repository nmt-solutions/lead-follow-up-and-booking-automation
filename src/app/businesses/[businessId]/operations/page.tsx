import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OperationsPanel } from "@/components/operations-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Activity and recovery" };
export default async function OperationsPage({
  params,
}: PageProps<"/businesses/[businessId]/operations">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).operations.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Activity and recovery</>}
        description={
          <>
            See what was authorized, what happened and who owns the next step.
          </>
        }
      ></PageHeader>
      <OperationsPanel initialState={state} businessId={businessId} />
    </div>
  );
}
