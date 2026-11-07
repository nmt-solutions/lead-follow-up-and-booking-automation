import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Refund and dispute review" };
export default async function FinancialReview() {
  const { queue, receipts } = await (async () => {
    try {
      const app = (await getServices()).financialAdjustments;
      return {
        queue: await app.queue(await headers()),
        receipts: await app.receipts(await headers()),
      };
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-4">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Refund and dispute review</h1>
        <p className="text-muted-foreground">
          Review the original paid charge, retained evidence and explicit access
          terms before a native financial action.
        </p>
      </header>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Businesses with paid financial history
        </h2>
        {!queue.length && (
          <p>No confirmed paid charge is available for review.</p>
        )}
        <ul className="space-y-3">
          {queue.map((b) => (
            <li key={b.businessId}>
              <Link
                href={`/platform/financial-adjustments/${b.businessId}`}
                className="inline-flex min-h-11 items-center text-primary underline"
              >
                {b.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Authenticated native receipts</h2>
        <p className="text-sm text-muted-foreground">
          Receipts queue independent native reconciliation. Receipt arrival
          alone does not change financial or access status. An unmatched dispute
          needs review against its original paid payment and seller invoice.
        </p>
        {!receipts.length && <p>No authenticated receipt retained.</p>}
        <ul className="space-y-3">
          {receipts.map((r) => (
            <li
              key={r.id}
              className="rounded-xl border border-border bg-card p-5 wrap-anywhere"
            >
              {r.receipt.eventName} ? {r.receipt.nativeId} ? payment{" "}
              {r.receipt.paymentId}
              <p className="text-sm text-muted-foreground">
                {r.receipt.eventId} ? received {r.at.toISOString()}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
