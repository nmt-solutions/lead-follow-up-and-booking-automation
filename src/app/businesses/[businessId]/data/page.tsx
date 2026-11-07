import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BusinessDataPanel } from "@/components/business-data-panel";
export const dynamic = "force-dynamic";
export const metadata = { title: "Data export and offboarding" };
export default async function BusinessDataPage({
  params,
}: PageProps<"/businesses/[businessId]/data">) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const s = await getServices(),
        c = await headers();
      return {
        state: await s.dataGovernance.workspace(c, businessId),
        payments: await s.subscriptionPayments.workspace(c, businessId),
      };
    } catch (e) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
          href={`/businesses/${businessId}`}
        >
          Back to Business
        </Link>
        <h1 className="page-title">Data export and offboarding</h1>
        <p className="mt-3 text-muted-foreground">
          Keep agreed records and review each step of stopping the service.
        </p>
      </header>
      <BusinessDataPanel
        businessId={businessId}
        initial={data.state}
        cancellations={data.payments.actions.map((a) => ({
          id: a.id,
          status: a.lifecycle?.state ?? a.state,
          timing: a.lifecycle?.policy?.cancellationTiming ?? null,
          access: a.lifecycle?.policy?.cancellationAccess ?? null,
          policy: a.lifecycle?.policy
            ? `${a.lifecycle.policy.id} v${a.lifecycle.policy.version}`
            : null,
        }))}
      />
    </div>
  );
}
