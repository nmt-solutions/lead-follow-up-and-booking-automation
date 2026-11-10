import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { FileManager } from "@/components/file-manager";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };
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
      <BusinessPageHeader section="files"></BusinessPageHeader>
      <FileManager businessId={businessId} initial={state.listing} />
    </div>
  );
}
