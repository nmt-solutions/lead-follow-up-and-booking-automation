import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CommercialActionsManager } from "@/components/commercial-actions-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Commercial actions" };
export default async function CommercialActionsPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]/commercial-actions">) {
  const { businessId, opportunityId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        commercial: await services.commercialActions.read(
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}/inbox`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to shared inbox
        </Link>
        <p className="mb-3 text-sm font-medium text-primary">
          {state.profile.name}
        </p>
        <h1 className="page-title">Commercial actions</h1>
        <p className="mt-3 text-muted-foreground">
          Review prices, custom quotations, discounts and order commitments for
          this Opportunity. Approvals and outcomes retain their exact terms and
          source evidence.
        </p>
        <p className="mt-2 text-sm text-muted-foreground wrap-anywhere">
          Opportunity {opportunityId}
        </p>
      </header>
      <CommercialActionsManager
        businessId={businessId}
        opportunityId={opportunityId}
        initialState={state.commercial}
      />
    </div>
  );
}
