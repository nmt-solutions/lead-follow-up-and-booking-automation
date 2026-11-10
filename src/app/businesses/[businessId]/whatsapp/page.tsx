import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { WhatsAppManager } from "@/components/whatsapp-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp identity" };
export default async function WhatsAppPage({
  params,
}: PageProps<"/businesses/[businessId]/whatsapp">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).whatsapp.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <PageHeader
        title={<>WhatsApp identity</>}
        description={
          <>
            Connect the account and number your Business controls. Review setup,
            supported Business App coexistence and your separate Meta bill.
          </>
        }
      ></PageHeader>
      <WhatsAppManager businessId={businessId} initialState={state} />
      <Link
        href={`/businesses/${businessId}/whatsapp/sending`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Review WhatsApp permissions and messages
      </Link>
    </div>
  );
}
