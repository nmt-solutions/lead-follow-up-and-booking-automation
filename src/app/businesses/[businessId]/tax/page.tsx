import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxManager } from "@/components/tax-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription tax preview" };
export default async function TaxPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).tax.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}/billing`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to billing profile
        </Link>
        <h1 className="page-title">Subscription tax preview</h1>
        <p className="mt-3 text-muted-foreground">
          See a calculated total or the reasons an operator review is required.
          Each request preserves its original evidence and treatment.
        </p>
      </header>
      <TaxManager businessId={businessId} initial={state} />
    </div>
  );
}
