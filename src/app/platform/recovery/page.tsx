import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { RecoveryPanel } from "@/components/recovery-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Infrastructure recovery" };
export default async function RecoveryPage() {
  const { state, canReconcileCosts } = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const canReconcileCosts = await services.team
        .requirePlatformCapability(credentials, "costs.manage")
        .then(
          () => true,
          () => false,
        );
      const state = await services.recovery.workspace(credentials);
      return { state, canReconcileCosts };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Infrastructure recovery</h1>
        <p className="mt-3 text-muted-foreground">
          Restore and inspect a reviewed Business snapshot in a private
          disposable environment. Track verified records, file coverage and
          unresolved work.
        </p>
      </header>
      <RecoveryPanel state={state} canReconcileCosts={canReconcileCosts} />
    </div>
  );
}
