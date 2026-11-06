import Link from "next/link";
import { headers } from "next/headers";
import { getServices } from "@/server/services";
import { pageFailure } from "@/server/page";
import { SenderHealthManager } from "@/components/sender-health-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "Sender health" };
export default async function SenderHealthPage({
  params,
}: PageProps<"/businesses/[businessId]/sender-health">) {
  const { businessId } = await params;
  const state = await (async () => {
    try {
      return await (
        await getServices()
      ).senderHealth.workspace(await headers(), businessId);
    } catch (error: unknown) {
      return pageFailure(error);
    }
  })();
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <Link
          href={`/businesses/${businessId}/senders`}
          className="mb-5 inline-flex min-h-11 items-center text-primary underline"
        >
          Back to sending identities
        </Link>
        <h1 className="page-title">Sender health</h1>
        <p className="mt-3 text-muted-foreground">
          Review authentication, bounce and complaint evidence and ask the
          responsible operator to repair affected senders. Share Business ID{" "}
          <span className="break-all">{businessId}</span> with authorized
          support.
        </p>
      </header>
      <SenderHealthManager state={state} />
    </div>
  );
}
