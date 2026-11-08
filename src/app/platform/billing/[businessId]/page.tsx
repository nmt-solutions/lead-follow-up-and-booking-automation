import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BillingManager } from "@/components/billing-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review billing evidence" };
export default async function BillingReviewPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        state: await services.billing.reviewWorkspace(credentials, businessId),
        files: await services.billingReviewFiles.list(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/platform/billing"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to evidence review queue
        </Link>
        <h1 className="page-title">Review billing evidence</h1>
        <Link
          href={`/platform/tax/${businessId}`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Review this Business’s tax calculations
        </Link>
        <p className="mt-3 text-muted-foreground wrap-anywhere">
          {data.state.current?.profile.legalName || "Legal name missing"} ·
          Business {businessId}
        </p>
      </header>
      <BillingManager
        businessId={businessId}
        initial={data.state}
        initialFiles={data.files}
        operator
      />
    </div>
  );
}
