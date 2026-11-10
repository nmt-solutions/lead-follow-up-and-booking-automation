import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { AiManager } from "@/components/ai-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI assistant" };
export default async function AiPage({
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
        workspace: await services.ai.workspace(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>AI assistant</>}
        description={
          <>
            Preview research reviews and sales drafts using approved business
            information. Provider settings are available to authorized
            operators.
          </>
        }
      ></PageHeader>
      <AiManager businessId={businessId} initialState={state.workspace} />
    </div>
  );
}
