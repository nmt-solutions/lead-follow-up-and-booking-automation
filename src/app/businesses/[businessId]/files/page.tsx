import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { FileManager } from "@/components/file-manager";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Private Business files" };
export default async function FilesPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        listing: await services.files.list(credentials, businessId),
      };
    } catch (error) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Private Business files</>}
        description={
          <>
            Upload approved documents and track ownership, access and deletion.
          </>
        }
      ></PageHeader>
      <FileManager businessId={businessId} initial={state.listing} />
    </div>
  );
}
