import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { EmailEligibilityManager } from "@/components/email-eligibility-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email eligibility and opt-outs" };
export default async function EmailEligibilityPage({
  params,
}: PageProps<"/businesses/[businessId]/email-eligibility">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).emailEligibility.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Email eligibility and opt-outs</>}
        description={
          <>
            Understand why a prepared email is allowed, blocked or unknown.
            Record purpose-specific evidence and honor effective opt-outs
            without losing sales history.
          </>
        }
      ></PageHeader>
      <EmailEligibilityManager businessId={businessId} initialState={state} />
    </div>
  );
}
