import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { WhatsAppSendingManager } from "@/components/whatsapp-sending-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp campaigns" };
export default async function Page({
  params,
}: PageProps<"/businesses/[businessId]/whatsapp/sending">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).whatsappSending.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>WhatsApp campaigns</>}
        description={
          <>
            Review contact permissions, templates and message outcomes. Meta
            bills WhatsApp usage separately.
          </>
        }
      ></PageHeader>
      <WhatsAppSendingManager businessId={businessId} initialState={state} />
    </div>
  );
}
