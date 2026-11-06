import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BillingManager } from "@/components/billing-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing profile and evidence" };
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 font-medium text-primary wrap-anywhere">
          {data.profile.name}
        </p>
        <h1 className="page-title">Billing profile and evidence</h1>
        <Link
          href={`/businesses/${businessId}/tax`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Subscription tax preview and review history
        </Link>
        <p className="mt-3 text-muted-foreground">
          Maintain the legal details for your platform subscription. Owners and
          Admins can submit changes; authorized tax operators review supporting
          evidence.
        </p>
      </header>
      <BillingManager
        businessId={businessId}
        initial={data.state}
        initialFiles={data.files}
      />
    </div>
  );
}
