import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SellerIssuerManager } from "@/components/seller-issuer-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Seller issuer configuration" };
export default async function IssuerConfiguration() {
  const catalog = await (async () => {
    try {
      return await (
        await getServices()
      ).sellerDocuments.catalog(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader title={<>Seller issuer configuration</>}>
        <Link
          href="/security"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Verify in Security
        </Link>
      </PageHeader>
      <SellerIssuerManager initial={catalog} />
    </div>
  );
}
