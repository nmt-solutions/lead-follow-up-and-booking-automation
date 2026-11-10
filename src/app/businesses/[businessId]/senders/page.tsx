import { BusinessPageHeader } from "@/components/business-page-header";
import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderManager } from "@/components/sender-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sending addresses" };
export default async function SendersPage({
  params,
}: PageProps<"/businesses/[businessId]/senders">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).senders.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="app-page">
      <BusinessPageHeader section="senders"></BusinessPageHeader>
      <Link
        href={`/businesses/${businessId}/mailboxes`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Manage email accounts
      </Link>
      <SenderManager businessId={businessId} initialState={state} />
      <Link
        href={`/businesses/${businessId}/sender-health`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Check email delivery
      </Link>
      <Link
        href={`/businesses/${businessId}/email-eligibility`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Manage contact permissions
      </Link>
    </div>
  );
}
