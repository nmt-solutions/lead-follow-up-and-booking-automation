import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CallManager } from "@/components/call-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Human calls" };
export default async function CallsPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]/calls">) {
  const { businessId, opportunityId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        calls: await services.calls.read(
          credentials,
          businessId,
          opportunityId,
        ),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="flex flex-col mx-auto max-w-3xl gap-8 wrap-anywhere">
      <PageHeader
        title={<>Human calls</>}
        description={
          <>
            Record human-led calls and attempts with written notes. A logged
            call does not confirm a sale, issue a quote, accept an order or
            confirm an appointment. No call is placed, message sent or audio
            captured by this form.
          </>
        }
      ></PageHeader>
      <CallManager businessId={businessId} initialState={state.calls} />
    </div>
  );
}
