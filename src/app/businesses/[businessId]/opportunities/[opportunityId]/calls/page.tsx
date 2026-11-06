import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { CallManager } from "@/components/call-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Human calls" };
export default async function CallsPage({
  params,
}: PageProps<"/businesses/[businessId]/opportunities/[opportunityId]/calls">) {
  const { businessId, opportunityId } = await params;
  const state = await (async () => {
    try {
      const services = await getServices();
      const credentials = await headers();
      return {
        profile: await services.application.getProfile(credentials, businessId),
        calls: await services.calls.read(
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
    <div className="mx-auto max-w-3xl space-y-8 wrap-anywhere">
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
        <h1 className="page-title">Human calls</h1>
        <p className="mt-3 font-medium">
          {state.calls.buyerName} · {state.calls.opportunityTitle}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Opportunity {opportunityId}
        </p>
        <p className="mt-3 text-muted-foreground">
          Record human-led calls and attempts with written notes. A logged call
          does not confirm a sale, issue a quote, accept an order or confirm an
          appointment. No call is placed, message sent or audio captured by this
          form.
        </p>
      </header>
      <CallManager businessId={businessId} initialState={state.calls} />
    </div>
  );
}
