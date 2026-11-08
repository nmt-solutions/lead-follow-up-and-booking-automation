import Link from "next/link";
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/platform/tax"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to tax calculation review
        </Link>
        <h1 className="page-title">Tax rules and approvals</h1>
        <p className="mt-3 text-muted-foreground">
          Effective-dated, evidence-backed coverage under separately provisioned
          tax-operator authority. A saved draft does not authorize treatment.
        </p>
      </header>
      <TaxRuleManager initial={catalog} />
    </div>
  );
}
