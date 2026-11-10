import { BusinessPageHeader } from "@/components/business-page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SellerDocumentManager } from "@/components/seller-document-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices" };
export default async function SellerDocuments({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const data = await (async () => {
    try {
      const services = await getServices(),
        credentials = await headers();
      return {
        state: await services.sellerDocuments.workspace(
          credentials,
          businessId,
        ),
        profile: await services.application.getProfile(credentials, businessId),
      };
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="seller-documents">
        <Link
          href={`/businesses/${businessId}/subscription-payments`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Payment history
        </Link>
      </BusinessPageHeader>
      <SellerDocumentManager businessId={businessId} initial={data.state} />
    </div>
  );
}
