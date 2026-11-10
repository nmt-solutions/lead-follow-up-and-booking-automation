import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
export const dynamic = "force-dynamic";
export const metadata = { title: "Seller document review" };
export default async function DocumentQueue() {
  const queue = await (async () => {
    try {
      return await (await getServices()).sellerDocuments.queue(await headers());
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>Seller document review</>}
        description={
          <>
            Issue payment-bound invoices, recover private artifacts and record
            linked credit notes.
          </>
        }
      >
        <Link
          href="/platform/seller-documents/configuration"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Configure and review the seller issuer
        </Link>
      </PageHeader>
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">
          Businesses with confirmed payments
        </h2>
        {!queue.length && (
          <p>No confirmed paid periods yet. Seller setup is available above.</p>
        )}
        {queue.map((b) => (
          <Link
            key={b.businessId}
            href={`/platform/seller-documents/${b.businessId}`}
            className="block rounded-xl border border-border bg-card p-6 text-primary underline wrap-anywhere"
          >
            {b.name} · {b.payments} confirmed payments
            <span className="mt-2 block text-sm text-muted-foreground">
              {b.businessId}
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
}
