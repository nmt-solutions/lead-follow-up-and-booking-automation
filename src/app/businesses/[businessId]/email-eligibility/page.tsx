import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { EmailEligibilityManager } from "@/components/email-eligibility-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email eligibility and opt-outs" };
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
          href={`/businesses/${businessId}`}
        >
          Back to overview
        </Link>
        <h1 className="page-title">Email eligibility and opt-outs</h1>
        <p className="mt-3 text-muted-foreground">
          Understand why a prepared email is allowed, blocked or unknown. Record
          purpose-specific evidence and honor effective opt-outs without losing
          sales history.
        </p>
      </header>
      <EmailEligibilityManager businessId={businessId} initialState={state} />
    </div>
  );
}
