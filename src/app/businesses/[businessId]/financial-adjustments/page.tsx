import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { FinancialAdjustmentManager } from "@/components/financial-adjustment-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Refunds and disputes" };
export default async function FinancialWorkspace({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).financialAdjustments.workspace(await headers(), businessId, false);
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-4">
        <Link
          href={`/businesses/${businessId}`}
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back
        </Link>
        <h1 className="page-title">Refunds and disputes</h1>
      </header>
      <FinancialAdjustmentManager
        businessId={businessId}
        initial={initial}
        operator={false}
      />
    </div>
  );
}
