import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { DiscoveryManager } from "@/components/discovery-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Find prospects" };
export default async function DiscoveryPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        workspace: await services.discovery.workspace(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="discovery"></BusinessPageHeader>
      <DiscoveryManager
        businessId={businessId}
        initialState={state.workspace}
      />
    </div>
  );
}
