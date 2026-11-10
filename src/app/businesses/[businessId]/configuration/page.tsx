import Link from "next/link";
import { headers } from "next/headers";
import { ConfigurationForm } from "@/components/configuration-form";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business setup" };
export default async function ConfigurationPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      const profile = await services.application.getProfile(
        credentials,
        businessId,
      );
      const access = await services.team.requireBusinessCapability(
        credentials,
        businessId,
        "profile.read",
      );
      return { profile, access };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to overview
        </Link>
        <p className="mb-3 text-sm font-medium text-primary wrap-anywhere">
          {state.profile.name}
        </p>
        <h1 className="page-title">Business setup</h1>
        <p className="mt-3 text-muted-foreground">
          Your saved products, customers, and search areas.
        </p>
      </div>
      <ConfigurationForm
        businessId={businessId}
        offering={state.profile.offering}
        homeMarket={state.profile.homeMarket}
        configuration={state.profile.configuration}
        readOnly={state.access.role === "salesperson"}
      />
    </div>
  );
}
