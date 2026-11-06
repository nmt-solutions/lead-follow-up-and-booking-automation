import Link from "next/link";
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href="/platform/whatsapp"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to WhatsApp reviews
        </Link>
        <h1 className="page-title">WhatsApp evidence review</h1>
        <p className="mt-3 text-muted-foreground">
          Record attributable evidence for the customer&apos;s selected account.
          Your WhatsApp review grant and an authenticator verification within
          the last 15 minutes are required. Reviewers cannot be members of the
          customer Business.
        </p>
      </header>
      <WhatsAppEvidenceReviewManager businessId={businessId} initial={state} />
    </div>
  );
}
