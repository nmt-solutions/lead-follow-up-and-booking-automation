import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { WhatsAppSendingManager } from "@/components/whatsapp-sending-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp messages" };
export default async function Page({
  params,
}: PageProps<"/businesses/[businessId]/whatsapp/sending">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).whatsappSending.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}/whatsapp`}
          className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to WhatsApp identity
        </Link>
        <h1 className="page-title mt-5">WhatsApp messages</h1>
        <p className="mt-3 text-muted-foreground">
          Review recipient permission, exact messages and saved outcomes. Your
          Business pays Meta separately.
        </p>
      </header>
      <WhatsAppSendingManager businessId={businessId} initialState={state} />
    </div>
  );
}
