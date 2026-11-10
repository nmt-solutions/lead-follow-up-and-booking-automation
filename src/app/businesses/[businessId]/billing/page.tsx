import { BusinessPageHeader } from "@/components/business-page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { BillingManager } from "@/components/billing-manager";
import { BillingDetailsForm } from "@/components/billing-details-form";
import { billingDefaults } from "@/models/billing-defaults";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing details" };
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { businessId } = await params;
  const advanced = (await searchParams).view === "review";
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      const state = await services.billing.workspace(credentials, businessId);
      return {
        identity: await services.access.primary(credentials),
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
      <BusinessPageHeader section="billing">
        <Link
          href={`/businesses/${businessId}/tax`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          View tax details
        </Link>
      </BusinessPageHeader>
      {advanced ? (
        <>
          <Link
            href={`/businesses/${businessId}/billing`}
            className="text-sm text-primary underline"
          >
            Back to billing details
          </Link>
          <BillingManager
            businessId={businessId}
            initial={data.state}
            initialFiles={data.files}
            businessProfile={{
              name: data.profile.name,
              configuration: data.profile.configuration,
            }}
          />
        </>
      ) : (
        <BillingDetailsForm
          businessId={businessId}
          initial={data.state}
          defaults={billingDefaults(
            data.state.current?.profile,
            data.profile,
            data.identity.user,
          )}
        />
      )}
    </div>
  );
}
