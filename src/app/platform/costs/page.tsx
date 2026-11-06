import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CostManager } from "@/components/cost-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Operator costs and budgets" };
export default async function OperatorCosts({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month =
    (await searchParams).month ?? new Date().toISOString().slice(0, 7);
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).costs.workspace(await headers(), month);
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-4">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Operator costs and budgets</h1>
        <p>
          Review attributable usage, commitments, gaps and responsible
          notifications.
        </p>
      </header>
      <CostManager initial={initial} />
    </div>
  );
}
