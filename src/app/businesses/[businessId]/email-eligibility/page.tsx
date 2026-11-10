import { BusinessPageHeader } from "@/components/business-page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { EmailEligibilityManager } from "@/components/email-eligibility-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact permissions" };
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
      <BusinessPageHeader section="email-eligibility"></BusinessPageHeader>
      <EmailEligibilityManager businessId={businessId} initialState={state} />
    </div>
  );
}
