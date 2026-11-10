import { PageHeader } from "@/components/page-header";

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
    <div className="flex flex-col mx-auto max-w-3xl gap-8 wrap-anywhere">
      <PageHeader
        title={<>Opportunity control</>}
        description={
          <>
            Takeover pauses this purchasing need across channels. Other
            Opportunities continue. After explicit handback, return to the
            sequence and resume for current policy and remaining allowance
            checks.
          </>
        }
      ></PageHeader>
      <OpportunityControl businessId={businessId} control={control} />
    </div>
  );
}
