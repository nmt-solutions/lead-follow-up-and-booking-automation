import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderHealthManager } from "@/components/sender-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Review sender health" };
export default async function ReviewPage({
  params,
}: PageProps<"/platform/sender-health/[businessId]">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).senderHealth.workspace(await headers(), businessId, true);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/platform/sender-health"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to operator alerts
        </Link>
        <h1 className="page-title">Review sender health</h1>
        <p className="mt-3 break-all text-muted-foreground">
          Business {businessId}. Your current sender-health capability and
          recent authenticator verification are required for every operation.
        </p>
      </header>
      <SenderHealthManager state={state} operator />
    </div>
  );
}
