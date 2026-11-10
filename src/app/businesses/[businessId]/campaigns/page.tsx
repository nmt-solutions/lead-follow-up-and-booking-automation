import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CampaignManager } from "@/components/campaign-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email campaigns" };
export default async function CampaignsPage({
  params,
}: PageProps<"/businesses/[businessId]/campaigns">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const [campaigns, sequences] = await Promise.all([
        services.campaigns.workspace(credentials, businessId),
        services.emailSequences.workspace(credentials, businessId),
      ]);
      return { campaigns, sequences };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="campaigns"></BusinessPageHeader>
      <CampaignManager
        businessId={businessId}
        initialState={state.campaigns}
        initialSequences={state.sequences}
      />
    </div>
  );
}
