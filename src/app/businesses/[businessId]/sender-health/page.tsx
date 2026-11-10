import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderHealthManager } from "@/components/sender-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sender health" };
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
      <PageHeader
        title={<>Sender health</>}
        description={
          <>
            Review authentication, bounce and complaint evidence and ask the
            responsible operator to repair affected senders. Share Business ID{" "}
            <span className="break-all">{businessId}</span> with authorized
            support.
          </>
        }
      ></PageHeader>
      <SenderHealthManager state={state} />
    </div>
  );
}
