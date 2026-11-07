import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { ReconciliationManager } from "@/components/reconciliation-manager";
import { reconciliationWorkspaceSchema } from "@/models/reconciliation";
export const dynamic = "force-dynamic";
export const metadata = { title: "Subscription money reconciliation" };
export default async function ReconciliationPage() {
  const current = new Date(),
    from = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1),
    ).toISOString(),
    until = new Date(
      Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1),
    ).toISOString();
  const initial = await (async () => {
    try {
      return reconciliationWorkspaceSchema.parse(
        await (
          await getServices()
        ).reconciliation.workspace(await headers(), { from, until }),
      );
    } catch (e: unknown) {
      return pageFailure(e);
    }
  })();
  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-4">
        <Link
          href="/businesses"
          className="inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Subscription money reconciliation</h1>
        <p className="text-muted-foreground">
          Trace original charges and tax through provider deductions,
          settlements and independent bank observations.
        </p>
      </header>
      <ReconciliationManager initial={initial} />
    </div>
  );
}
