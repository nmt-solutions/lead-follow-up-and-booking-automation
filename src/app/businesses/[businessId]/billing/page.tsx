import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BillingManager } from "@/components/billing-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing details" };
export default async function BillingPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const state = await services.billing.workspace(credentials, businessId);
      return {
        state,
        profile: await services.application.getProfile(credentials, businessId),
        files: await services.files.list(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Billing details</>}
        description={
          <>
            Maintain the legal details for your platform subscription. Owners
            and Admins can submit changes; authorized tax operators review
            supporting evidence.
          </>
        }
      >
        <Link
          href={`/businesses/${businessId}/tax`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Subscription tax preview and review history
        </Link>
      </PageHeader>
      <BillingManager
        businessId={businessId}
        initial={data.state}
        initialFiles={data.files}
        businessProfile={{
          name: data.profile.name,
          configuration: data.profile.configuration,
        }}
      />
    </div>
  );
}
