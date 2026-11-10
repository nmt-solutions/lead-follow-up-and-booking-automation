import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SellerDocumentManager } from "@/components/seller-document-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Business seller documents" };
export default async function OperatorDocuments({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).sellerDocuments.workspace(await headers(), businessId, true);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Business seller documents</>}
        description={<>Business {businessId}</>}
      >
        <Link
          href="/platform/seller-documents/configuration"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Review issuer configuration
        </Link>
      </PageHeader>
      <SellerDocumentManager businessId={businessId} initial={state} operator />
    </div>
  );
}
