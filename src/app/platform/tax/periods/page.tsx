import { PageHeader } from "@/components/page-header";
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
    <div className="app-page">
      <PageHeader
        title={<>Tax periods and liability review</>}
        description={
          <>
            Configured obligations, original transaction evidence and
            accountable review. Preparing, approving or exporting a report does
            not file a return or pay tax.
          </>
        }
      >
        <Link
          href="/platform/tax/filings"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Record filing and remittance confirmations
        </Link>
      </PageHeader>
      <TaxPeriodManager initial={initial} />
    </div>
  );
}
