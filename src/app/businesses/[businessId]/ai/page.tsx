import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { AiManager } from "@/components/ai-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI profiles and previews" };
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
    <div className="mx-auto max-w-4xl space-y-8">
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
        <h1 className="page-title">AI profiles and previews</h1>
        <p className="mt-3 text-muted-foreground">
          Platform operator controls. Review extraction and drafting against
          this Business’s approved knowledge before changing the shared profile.
          Previews never send messages.
        </p>
      </div>
      <AiManager businessId={businessId} initialState={state.workspace} />
    </div>
  );
}
