import Link from "next/link";
import { PublicShell } from "@/components/public-shell";
import { PlanCards } from "@/components/plan-cards";
import { publicMetadata } from "@/lib/public-site";
import { plans, formatPlanPrice } from "@/content/plans";
export const metadata = publicMetadata(
  "Pricing",
  "Compare Lead Relay monthly plans, included discovery and outreach allowances, taxes and cancellation terms.",
  "/pricing",
);
export default function PricingPage() {
  return (
    <PublicShell marketing>
      <div className="page-container flex flex-col gap-12 py-16 sm:py-24">
        <header className="mx-auto flex max-w-2xl flex-col gap-4 text-center">
          <p className="text-sm font-medium text-primary">Lead Relay plans</p>
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
            Find your next customers.
            <br />
            Choose your pace.
          </h1>
          <p className="text-lg text-muted-foreground">
            One plan for your business. Clear monthly allowances shared by your
            team. Set up your business first and review the full total before
            paying.
          </p>
        </header>
        <PlanCards />
        <section className="flex flex-col gap-5">
          <h2 className="font-display text-2xl">Compare the allowances</h2>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">
                Monthly Lead Relay plan comparison
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="p-5">
                    Per business, each month
                  </th>
                  {plans.map((plan) => (
                    <th scope="col" className="p-5" key={plan.id}>
                      {plan.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Subscription before tax",
                    ...plans.map((plan) => formatPlanPrice(plan.monthlyMinor)),
                  ],
                  [
                    "Discovery credits",
                    ...plans.map((plan) =>
                      plan.discovery.toLocaleString("en-IN"),
                    ),
                  ],
                  [
                    "Outreach actions",
                    ...plans.map((plan) =>
                      plan.automation.toLocaleString("en-IN"),
                    ),
                  ],
                  ["Included market", "India", "India", "India"],
                  [
                    "Email, calendar and team access",
                    "Included",
                    "Included",
                    "Included",
                  ],
                  ["Automatic overage charges", "None", "None", "None"],
                ].map(([label, ...values]) => (
                  <tr
                    className="border-b border-border last:border-0"
                    key={label}
                  >
                    <th scope="row" className="p-5 font-medium">
                      {label}
                    </th>
                    {values.map((value, i) => (
                      <td className="p-5 text-muted-foreground" key={i}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl">
              What is a discovery credit?
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Credits pay for the work behind a search: finding sources, reading
              pages and reviewing evidence. A search request uses 8 credits; a
              page read or evidence review uses 1. Your search shows its budget
              before it starts. Credits measure work, so they do not promise a
              number of leads or sales.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl">
              What is an outreach action?
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              One reserved provider call for an approved automation step.
              Attempts can use allowance even if delivery fails. Connecting an
              inbox does not authorize campaigns. Your mailbox subscription and
              Meta or WhatsApp charges are separate.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl">What happens at the limit?</h2>
            <p className="text-sm leading-7 text-muted-foreground">
              New discovery and outbound work pauses when the relevant allowance
              runs out. There are no automatic overage charges. Unused
              allowances expire at the end of the billing period. Billing,
              cancellation and required recovery remain available.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-xl">
              How do renewal and cancellation work?
            </h2>
            <p className="text-sm leading-7 text-muted-foreground">
              Plans renew monthly with your payment authorization. Applicable
              taxes and the exact renewal amount appear before checkout. Cancel
              in Plan &amp; billing before the next renewal; confirmed
              cancellation preserves access through the paid period.{" "}
              <Link
                className="text-primary underline"
                href="/cancellation-policy"
              >
                Read the cancellation policy
              </Link>
              .
            </p>
          </div>
        </section>
        <p className="text-sm leading-7 text-muted-foreground">
          Plans cover Lead Relay&apos;s AI, search, background processing and
          transactional notifications within the stated allowances. Availability
          depends on supported integrations and payment activation.
          International billing and additional markets are available only after
          payment and tax support is confirmed.{" "}
          <Link href="/refund-policy" className="text-primary underline">
            Refund policy
          </Link>{" "}
          ·{" "}
          <Link href="/terms" className="text-primary underline">
            Terms
          </Link>
          .
        </p>
      </div>
    </PublicShell>
  );
}
