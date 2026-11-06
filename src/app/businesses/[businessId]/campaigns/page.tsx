import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CampaignManager } from "@/components/campaign-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-outreach campaigns" };
export default async function CampaignsPage({
  params,
}: PageProps<"/businesses/[businessId]/campaigns">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const [campaigns, sequences] = await Promise.all([
        services.campaigns.workspace(credentials, businessId),
        services.emailSequences.workspace(credentials, businessId),
      ]);
      return { campaigns, sequences };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Business
        </Link>
        <h1 className="page-title">First-outreach campaigns</h1>
        <p className="mt-3 text-muted-foreground">
          Review sourced recipients and a bounded message plan before first
          contact. Approval, current permission and execution remain separate.
        </p>
      </header>
      <CampaignManager
        businessId={businessId}
        initialState={state.campaigns}
        initialSequences={state.sequences}
      />
    </div>
  );
}
