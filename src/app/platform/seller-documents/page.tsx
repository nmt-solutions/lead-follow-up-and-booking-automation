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
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href="/businesses"
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to Businesses
        </Link>
        <h1 className="page-title">Seller document review</h1>
        <p className="mt-3 text-muted-foreground">
          Issue payment-bound invoices, recover private artifacts and record
          linked credit notes.
        </p>
        <Link
          href="/platform/seller-documents/configuration"
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
        >
          Configure and review the seller issuer
        </Link>
      </header>
      <section className="space-y-4">
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
