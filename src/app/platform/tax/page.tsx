import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { Badge } from "@/components/ui/badge";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tax calculation review" };
export default async function TaxReviewQueue() {
  const queue = await (async () => {
    try {
      return await (await getServices()).tax.reviewQueue(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Tax calculation review</>}
        description={
          <>
            Resolve evidence or supported treatment, then record a successor
            calculation. Existing snapshots remain unchanged.
          </>
        }
      >
        <Link
          href="/platform/tax/rules"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Manage tax rules and approvals
        </Link>
        <Link
          href="/platform/tax/periods"
          className="ml-4 mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Prepare tax periods and review liability
        </Link>
      </PageHeader>
      {!queue.length && (
        <p className="rounded-2xl border border-border bg-card p-6">
          No unresolved tax calculation requests. Rules and evidence still need
          approval before live calculations can succeed.
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {queue.map(({ businessId, calculation }) => (
          <li key={calculation.id}>
            <Link
              href={`/platform/tax/${businessId}`}
              className="flex flex-col block gap-3 rounded-2xl border border-border bg-card p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <h2 className="text-xl font-semibold wrap-anywhere">
                {calculation.billing.current?.profile.legalName ||
                  "Billing profile missing"}
              </h2>
              <Badge>Review required · {calculation.mode}</Badge>
              <p className="wrap-anywhere">
                Calculation {calculation.version} · {calculation.currency} ·{" "}
                {calculation.reasons
                  .map((reason) => reason.kind)
                  .filter((kind, index, list) => list.indexOf(kind) === index)
                  .join(", ")}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
