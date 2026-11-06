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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/platform/seller-documents"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to seller document review
        </Link>
        <h1 className="page-title">Business seller documents</h1>
        <p className="mt-3 text-muted-foreground wrap-anywhere">
          Business {businessId}
        </p>
        <Link
          href="/platform/seller-documents/configuration"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Review issuer configuration
        </Link>
      </header>
      <SellerDocumentManager businessId={businessId} initial={state} operator />
    </div>
  );
}
