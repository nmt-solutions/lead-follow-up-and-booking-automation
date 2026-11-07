import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ReachChangeManager } from "@/components/reach-change-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Reach change recovery" };
export default async function ReachChangeQueue() {
  const state = await (async () => {
    try {
      return await (await getServices()).reachChanges.queue(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/platform/subscription-payments"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to payment review
        </Link>
        <h1 className="page-title">Reach change recovery</h1>
        <p className="mt-3 text-muted-foreground">
          Reconcile saved Business approvals and exact native references.
          Unknown financial actions stay with their original intent.
        </p>
      </header>
      <ReachChangeManager initial={state} operator />
    </div>
  );
}
