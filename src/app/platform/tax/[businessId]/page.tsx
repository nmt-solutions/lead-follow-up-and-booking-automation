import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxManager } from "@/components/tax-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Resolve subscription tax review" };
export default async function TaxReviewPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).tax.reviewWorkspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/platform/tax"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to tax calculation review
        </Link>
        <h1 className="page-title">Resolve subscription tax review</h1>
        <p className="mt-3 text-muted-foreground wrap-anywhere">
          {state.billing.current?.profile.legalName ||
            "Billing profile missing"}{" "}
          · Business {businessId}
        </p>
        <Link
          href="/platform/tax/rules"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Manage tax rules and approvals
        </Link>
      </header>
      <TaxManager initial={state} businessId={businessId} operator />
    </div>
  );
}
