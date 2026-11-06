import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SellerDocumentManager } from "@/components/seller-document-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Invoices and credit notes" };
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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Business profile
        </Link>
        <p className="mb-3 font-medium text-primary wrap-anywhere">
          {data.profile.name}
        </p>
        <h1 className="page-title">Invoices and credit notes</h1>
        <p className="mt-3 text-muted-foreground">
          Review your numbered seller documents and their original transaction
          details.
        </p>
        <Link
          href={`/businesses/${businessId}/subscription-payments`}
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Review subscription payments
        </Link>
      </header>
      <SellerDocumentManager businessId={businessId} initial={data.state} />
    </div>
  );
}
