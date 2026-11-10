import Link from "next/link";
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
        <h1 className="page-title">Saved answers</h1>
        <p className="mt-3 text-muted-foreground">
          Review the information sales conversations can use. Profile
          descriptions and private files become authoritative only after an
          explicit review here.
        </p>
      </div>
      <KnowledgeManager
        businessId={businessId}
        initialState={state.workspace}
      />
    </div>
  );
}
