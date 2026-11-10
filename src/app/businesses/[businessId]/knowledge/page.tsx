import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { KnowledgeManager } from "@/components/knowledge-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Saved answers" };
export default async function KnowledgePage({
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
        workspace: await services.knowledge.workspace(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Saved answers</>}
        description={
          <>
            Review the information sales conversations can use. Profile
            descriptions and private files become authoritative only after an
            explicit review here.
          </>
        }
      ></PageHeader>
      <KnowledgeManager
        businessId={businessId}
        initialState={state.workspace}
      />
    </div>
  );
}
