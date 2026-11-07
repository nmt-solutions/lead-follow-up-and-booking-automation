import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxPeriodManager } from "@/components/tax-period-manager";
import { taxPeriodScreenSchema } from "@/models/tax-periods";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tax periods and liability review" };
export default async function TaxPeriodsPage() {
  const initial = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers(),
        preferences = await services.notifications.preferences(
          credentials,
          null,
        ),
        workspace = await services.taxPeriods.workspace(credentials);
      return taxPeriodScreenSchema.parse({
        workspace,
        emailPreference:
          preferences.find((p) => p.purpose === "tax_period") ?? null,
      });
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header>
        <Link
          href="/platform/tax"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to tax calculation review
        </Link>
        <h1 className="page-title">Tax periods and liability review</h1>
        <p className="mt-3 text-muted-foreground">
          Configured obligations, original transaction evidence and accountable
          review. Preparing, approving or exporting a report does not file a
          return or pay tax.
        </p>
      </header>
      <TaxPeriodManager initial={initial} />
    </div>
  );
}
