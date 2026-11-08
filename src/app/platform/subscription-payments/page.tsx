import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SubscriptionPaymentOperator } from "@/components/subscription-payment-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription payment review" };
export default async function SubscriptionPaymentReview() {
  const unmatched = await (async () => {
    try {
      return await (
        await getServices()
      ).subscriptionPayments.unmatchedEvents(await headers());
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  const initial = await (async () => {
    try {
      return await (
        await getServices()
      ).subscriptionPayments.operatorQueue(await headers());
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Subscription payment review</h1>
        <Link
          href="/platform/reach-changes"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Review and recover approved reach changes
        </Link>
      </header>
      <SubscriptionPaymentOperator initial={initial} />
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">
          Unmatched authenticated payment events
        </h2>
        {!unmatched.length && <p>No unmatched events.</p>}
        {unmatched.map((e) => (
          <details
            key={e.id}
            className="rounded-xl border border-border bg-card p-6"
          >
            <summary className="min-h-11 cursor-pointer py-3">
              {e.provider} - {e.eventId} - operator review required
            </summary>
            <p className="my-3 text-sm text-muted-foreground">
              No paid access was granted. Verify the merchant operation and
              provider references; never assign an event using a customer
              declaration.
            </p>
            <pre className="overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(e, null, 2)}
            </pre>
          </details>
        ))}
      </section>
    </div>
  );
}
