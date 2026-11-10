import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CommercialActionsManager } from "@/components/commercial-actions-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commercial actions" };
export default async function CommercialActionsPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]/commercial-actions">) {
  const { businessId, opportunityId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        commercial: await services.commercialActions.read(
          credentials,
          businessId,
          opportunityId,
        ),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Commercial actions</>}
        description={<>Opportunity {opportunityId}</>}
      ></PageHeader>
      <CommercialActionsManager
        businessId={businessId}
        opportunityId={opportunityId}
        initialState={state.commercial}
      />
    </div>
  );
}
