import Link from "next/link";
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
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 text-sm font-medium text-primary wrap-anywhere">
          {state.profile.name}
        </p>
        <h1 className="page-title">Private Business files</h1>
        <p className="mt-3 text-muted-foreground">
          Upload approved documents and track ownership, access and deletion.
        </p>
      </div>
      <FileManager businessId={businessId} initial={state.listing} />
    </div>
  );
}
