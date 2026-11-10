import Link from "next/link";
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
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to overview
        </Link>
        <p className="mb-3 text-sm font-medium text-primary wrap-anywhere">
          {state.profile.name}
        </p>
        <h1 className="page-title">Find prospects</h1>
        <p className="mt-3 text-muted-foreground">
          Find potential customers in your search areas. Review the sources
          behind each match before choosing who to contact.
        </p>
      </div>
      <DiscoveryManager
        businessId={businessId}
        initialState={state.workspace}
      />
    </div>
  );
}
