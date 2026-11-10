import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxFilingManager } from "@/components/tax-filing-manager";
import { taxFilingWorkspaceSchema } from "@/models/tax-filings";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tax filing and remittance confirmations" };
export default async function TaxFilingsPage() {
  const initial = await (async () => {
    try {
      return taxFilingWorkspaceSchema.parse(
        await (await getServices()).taxFilings.workspace(await headers()),
      );
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Tax filing and remittance confirmations</>}
        description={
          <>
            Approved exports, separate manual approvals and evidence-backed
            confirmations. Filing and remittance remain distinct; original
            records survive corrections.
          </>
        }
      ></PageHeader>
      <TaxFilingManager initial={initial} />
    </div>
  );
}
