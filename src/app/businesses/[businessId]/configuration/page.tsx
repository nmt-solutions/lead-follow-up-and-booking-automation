import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { ConfigurationForm } from "@/components/configuration-form";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search setup" };
export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      const profile = await services.application.getProfile(
        credentials,
        businessId,
      );
      const access = await services.team.requireBusinessCapability(
        credentials,
        businessId,
        "profile.read",
      );
      return { profile, access };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="configuration"></BusinessPageHeader>
      <ConfigurationForm
        businessId={businessId}
        offering={state.profile.offering}
        homeMarket={state.profile.homeMarket}
        configuration={state.profile.configuration}
        readOnly={state.access.role === "salesperson"}
      />
    </div>
  );
}
