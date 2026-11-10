import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderManager } from "@/components/sender-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sending identities" };
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
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline underline-offset-4"
        >
          Back to overview
        </Link>
        <h1 className="page-title">Sending identities</h1>
        <p className="mt-3 text-muted-foreground">
          Configure the Business identity people see, its intended uses and
          where replies go. Domain authentication, sending access and two-way
          reply handling are separate requirements.
        </p>
      </header>
      <Link
        href={`/businesses/${businessId}/mailboxes`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Choose mailbox processing scope and optional history
      </Link>
      <SenderManager businessId={businessId} initialState={state} />
      <Link
        href={`/businesses/${businessId}/sender-health`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Review sender health, incident alerts and repair evidence
      </Link>
      <Link
        href={`/businesses/${businessId}/email-eligibility`}
        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
      >
        Review recipient eligibility and opt-outs
      </Link>
    </div>
  );
}
