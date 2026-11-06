import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { OpportunityControl } from "@/components/opportunity-control";
export const dynamic = "force-dynamic";
export const metadata = { title: "Opportunity control" };
export default async function OpportunityPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]">) {
  const { businessId, opportunityId } = await params;
  const control = await (async () => {
    try {
      return await (
        await getServices()
      ).opportunities.read(await headers(), businessId, opportunityId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8 wrap-anywhere">
      <header>
        <Link
          href={`/businesses/${businessId}/campaigns`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to campaigns
        </Link>
        <h1 className="page-title">Opportunity control</h1>
        <p className="mt-3 font-medium">{control.title}</p>
        <p className="mt-3 text-muted-foreground">
          Takeover pauses this purchasing need across channels. Other
          Opportunities continue. After explicit handback, return to the
          sequence and resume for current policy and remaining allowance checks.
        </p>
      </header>
      <OpportunityControl businessId={businessId} control={control} />
    </div>
  );
}
