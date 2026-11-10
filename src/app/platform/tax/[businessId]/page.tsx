import { PageHeader } from "@/components/page-header";
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
    <div className="app-page">
      <PageHeader
        title={<>Resolve subscription tax review</>}
        description={
          <>
            {state.billing.current?.profile.legalName ||
              "Billing profile missing"}{" "}
            · Business {businessId}
          </>
        }
      >
        <Link
          href="/platform/tax/rules"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Manage tax rules and approvals
        </Link>
      </PageHeader>
      <TaxManager initial={state} businessId={businessId} operator />
    </div>
  );
}
