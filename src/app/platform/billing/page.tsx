import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { billingStatuses } from "@/components/billing-summary";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing evidence review queue" };
export default async function BillingQueuePage() {
  const queue = await (async () => {
    try {
      return await (await getServices()).billing.reviewQueue(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Billing evidence review</h1>
        <p className="mt-3 text-muted-foreground">
          Submitted profiles needing tax-operator review. Missing and
          conflicting evidence remains unresolved until a recorded review of the
          exact revision.
        </p>
      </header>
      {!queue.length && (
        <p className="rounded-2xl border border-border bg-card p-6">
          No submitted profiles currently need review.
        </p>
      )}
      <ul className="space-y-4">
        {queue.map((entry) => (
          <li key={entry.businessId}>
            <Link
              href={`/platform/billing/${entry.businessId}`}
              className="block space-y-3 rounded-2xl border border-border bg-card p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <h2 className="text-xl font-semibold wrap-anywhere">
                {entry.workspace.current?.profile.legalName ||
                  "Legal name missing"}
              </h2>
              <Badge>{billingStatuses[entry.status]}</Badge>
              <p className="text-sm text-muted-foreground wrap-anywhere">
                Business {entry.businessId} · Revision {entry.workspace.version}{" "}
                · {entry.workspace.currency ?? "Country unknown"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
