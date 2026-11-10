import { PageHeader } from "@/components/page-header";

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
    <div className="app-page">
      <PageHeader
        title={<>Subscription money reconciliation</>}
        description={
          <>
            Trace original charges and tax through provider deductions,
            settlements and independent bank observations.
          </>
        }
      ></PageHeader>
      <ReconciliationManager initial={initial} />
    </div>
  );
}
