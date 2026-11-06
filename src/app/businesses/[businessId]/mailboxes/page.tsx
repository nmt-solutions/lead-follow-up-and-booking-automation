import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { MailboxManager } from "@/components/mailbox-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Mailbox processing" };
export default async function MailboxesPage({
  params,
}: PageProps<"/businesses/[businessId]/mailboxes">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).mailboxes.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to Business
        </Link>
        <h1 className="page-title">Mailbox processing</h1>
      </header>
      <MailboxManager businessId={businessId} initialState={state} />
    </div>
  );
}
