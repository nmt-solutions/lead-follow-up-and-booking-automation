import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OperationsPanel } from "@/components/operations-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Activity and recovery" };
export default async function OperationsPage({
  params,
}: PageProps<"/businesses/[businessId]/operations">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).operations.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="space-y-8">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}`}
        >
          Back to overview
        </Link>
        <h1 className="page-title">Activity and recovery</h1>
        <p className="mt-3 text-muted-foreground">
          See what was authorized, what happened and who owns the next step.
        </p>
      </header>
      <OperationsPanel initialState={state} businessId={businessId} />
    </div>
  );
}
