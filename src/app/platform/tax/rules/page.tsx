import { PageHeader } from "@/components/page-header";

import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { TaxRuleManager } from "@/components/tax-rule-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Tax rules and approvals" };
export default async function TaxRulesPage() {
  const catalog = await (async () => {
    try {
      return await (await getServices()).tax.rules(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Tax rules and approvals</>}
        description={
          <>
            Effective-dated, evidence-backed coverage under separately
            provisioned tax-operator authority. A saved draft does not authorize
            treatment.
          </>
        }
      ></PageHeader>
      <TaxRuleManager initial={catalog} />
    </div>
  );
}
