import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OperationsPanel } from "@/components/operations-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Platform operations" };
export default async function PlatformOperationsPage() {
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).operations.workspace(await headers(), null, true);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="space-y-8">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
          href="/businesses"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Platform operations</h1>
        <p className="mt-3 text-muted-foreground">
          Inspect runs, queues and channel health. Maintenance keeps each
          Business’s authorization, ownership and limits.
        </p>
      </header>
      <OperationsPanel initialState={state} />
    </div>
  );
}
