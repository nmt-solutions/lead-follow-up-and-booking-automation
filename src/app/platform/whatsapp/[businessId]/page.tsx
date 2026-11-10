import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { WhatsAppEvidenceReviewManager } from "@/components/whatsapp-evidence-review-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp evidence review" };
export default async function ReviewPage({
  params,
}: PageProps<"/platform/whatsapp/[businessId]">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).whatsapp.reviewWorkspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>WhatsApp evidence review</>}
        description={
          <>
            Record attributable evidence for the customer&apos;s selected
            account. Your WhatsApp review grant and an authenticator
            verification within the last 15 minutes are required. Reviewers
            cannot be members of the customer Business.
          </>
        }
      ></PageHeader>
      <WhatsAppEvidenceReviewManager businessId={businessId} initial={state} />
    </div>
  );
}
