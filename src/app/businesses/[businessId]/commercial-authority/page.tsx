import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CommercialAuthorityManager } from "@/components/commercial-authority-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commercial authority" };
export default async function CommercialAuthorityPage({
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
        workspace: await services.commercialAuthority.workspace(
          credentials,
          businessId,
        ),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Commercial authority</>}
        description={
          <>
            Control prices, custom quotations, discounts and order acceptance.
            Every action requires approval until an Owner or Admin explicitly
            enables automation within configured limits.
          </>
        }
      ></PageHeader>
      <CommercialAuthorityManager
        businessId={businessId}
        initialState={state.workspace}
      />
    </div>
  );
}
